import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { db } from '../../../../data/db.ts'
import { listPostFiles } from '../../../../data/media.ts'
import { getPosts, isPostId, newPostId } from '../../../../data/posts.ts'
import { fromPostRecord, posts } from '../../../../data/tables.ts'
import { routes } from '../../../../routes.ts'
import { adminMiddleware, requireAdminLogin } from '../../middleware.ts'
import { newPostDate, readPostForm, savePostUploads, validatePostForm } from '../form-values.ts'
import { renderPostForm } from '../post-form.tsx'

export default createController(routes.admin.posts.new, {
  middleware: [...adminMiddleware, requireAdminLogin()],
  actions: {
    async index(context) {
      let [newest] = await getPosts()
      let values = { id: newPostId(), type: 'text', date: newPostDate(newest?.date) }
      return context.render(...renderPostForm(context.request, { isNew: true, values, files: [] }))
    },
    async action(context) {
      let id = context.formData.get('id')
      let form = readPostForm(context.formData, typeof id === 'string' ? id : '')
      let { values } = form
      let result
      // Only a form submitted twice gets here, since every new post form has a new id. Its files
      // aren't saved, so they can't replace the published post's.
      if (await db.find(posts, values.id)) {
        result = {
          success: false as const,
          issues: [{ message: 'This post was already published.' }],
        }
      } else {
        // An invalid id is one of the issues validatePostForm finds; files aren't saved under it.
        if (isPostId(values.id)) await savePostUploads(values.id, form.uploads)
        result = await validatePostForm(values, form.issues)
      }
      if (!result.success) {
        let { issues } = result
        let files = isPostId(values.id) ? await listPostFiles(values.id) : []
        return context.render(
          ...renderPostForm(context.request, { isNew: true, values, files, issues }),
        )
      }

      await db.create(posts, fromPostRecord(result.record))
      return redirect(routes.posts.show.href({ id: values.id }), 303)
    },
  },
})
