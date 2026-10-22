// A stand-in for an S3 bucket, slow to send objects, for smoke-test.ts: it checks the server still
// answers when a media read takes longer than its runtime's idle timeout. Keeps objects in memory
// and only does what remix/file-storage's S3 backend does: PUT, GET, HEAD, and DELETE objects, and
// list them (without paging).
import * as http from 'node:http'

let objects = new Map<string, { body: Buffer; headers: Record<string, string> }>()

// Listens on the port, waiting delay seconds before sending an object.
export function startFakeS3(port: number, delay: number): Promise<http.Server> {
  let server = http.createServer(async (req, res) => {
    let url = new URL(req.url ?? '/', 'http://localhost')
    let key = url.pathname
    let object = objects.get(key)
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      return res.writeHead(200, { 'Content-Type': 'application/xml' }).end(list(key, url))
    }
    switch (req.method) {
      case 'PUT': {
        let chunks: Buffer[] = []
        for await (let chunk of req) chunks.push(chunk)
        let headers: Record<string, string> = {}
        for (let name of [
          'content-type',
          'x-amz-meta-file-name',
          'x-amz-meta-file-last-modified',
        ]) {
          let value = req.headers[name]
          if (typeof value === 'string') headers[name] = value
        }
        objects.set(key, { body: Buffer.concat(chunks), headers })
        return res.writeHead(200).end()
      }
      case 'DELETE':
        objects.delete(key)
        return res.writeHead(204).end()
      case 'HEAD':
      case 'GET': {
        if (!object) return res.writeHead(404).end()
        res.writeHead(200, { ...object.headers, 'Content-Length': object.body.length })
        if (req.method === 'HEAD') return res.end()
        await new Promise((resolve) => setTimeout(resolve, delay * 1000))
        return res.end(object.body)
      }
      default:
        return res.writeHead(405).end()
    }
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

// A ListObjectsV2 result for the bucket at bucketPath, with the keys URL-encoded as it asks.
function list(bucketPath: string, url: URL) {
  let prefix = url.searchParams.get('prefix') ?? ''
  let contents = [...objects]
    .map(([path, object]) => ({
      key: decodeURIComponent(path.slice(bucketPath.length + 1)),
      object,
    }))
    .filter(({ key }) => key.startsWith(prefix))
    .map(({ key, object }) => {
      let size = object.body.length
      return `<Contents><Key>${encodeURIComponent(key)}</Key><Size>${size}</Size></Contents>`
    })
  return `<ListBucketResult><IsTruncated>false</IsTruncated>${contents.join('')}</ListBucketResult>`
}
