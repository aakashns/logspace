// An SMTP server for the tests, on a free port of 127.0.0.1, so sending email goes over a real
// connection, as it would to Mailpit or an email service, without either. It accepts any login and
// keeps each message it's sent, unless `refuse` sets a reply for a command, like "MAIL" or "AUTH".
// It doesn't do TLS: the tests send with no security, as to Mailpit.
export interface ReceivedEmail {
  readonly login: string | undefined
  readonly from: string
  readonly to: string[]
  // The message as sent, headers and all.
  readonly data: string
}

export async function startSmtpServer() {
  let received: ReceivedEmail[] = []
  let refuse: Record<string, string> = {}
  let server = Bun.listen<{
    buffer: string
    reading: boolean
    login: string | undefined
    from: string
    to: string[]
  }>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: '', reading: false, login: undefined, from: '', to: [] }
        socket.write('220 test ESMTP\r\n')
      },
      data(socket, chunk) {
        let state = socket.data
        state.buffer += chunk.toString()
        for (;;) {
          if (state.reading) {
            let end = state.buffer.indexOf('\r\n.\r\n')
            if (end === -1) return
            let data = state.buffer.slice(0, end).replaceAll('\r\n..', '\r\n.')
            state.buffer = state.buffer.slice(end + 5)
            state.reading = false
            received.push({ login: state.login, from: state.from, to: state.to, data })
            state.to = []
            socket.write('250 2.0.0 Ok: queued\r\n')
            continue
          }
          let end = state.buffer.indexOf('\r\n')
          if (end === -1) return
          let line = state.buffer.slice(0, end)
          state.buffer = state.buffer.slice(end + 2)
          let command = line.split(' ')[0]?.toUpperCase() ?? ''
          let refusal = refuse[command]
          if (refusal) socket.write(`${refusal}\r\n`)
          else if (command === 'EHLO') socket.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n')
          else if (command === 'AUTH') {
            // AUTH PLAIN <base64 of "\0user\0password">.
            let [, user] = atob(line.split(' ')[2] ?? '').split('\0')
            state.login = user
            socket.write('235 2.7.0 Authentication successful\r\n')
          } else if (command === 'MAIL') {
            state.from = /<(.*)>/.exec(line)?.[1] ?? ''
            socket.write('250 2.1.0 Ok\r\n')
          } else if (command === 'RCPT') {
            state.to.push(/<(.*)>/.exec(line)?.[1] ?? '')
            socket.write('250 2.1.5 Ok\r\n')
          } else if (command === 'DATA') {
            state.reading = true
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
          } else if (command === 'QUIT') {
            socket.write('221 2.0.0 Bye\r\n')
            socket.end()
          } else socket.write('250 Ok\r\n')
        }
      },
    },
  })
  return {
    port: server.port,
    received,
    // Answers each of these commands with its reply, or every command as usual with {}.
    refuse: (replies: Record<string, string>) => {
      refuse = replies
    },
    stop: () => server.stop(true),
  }
}
