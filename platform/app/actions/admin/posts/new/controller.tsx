import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { listPostFiles } from '../../../../data/media.ts'
import { isPostId, newPostId } from '../../../../data/posts/model.ts'
import { createPost } from '../../../../data/posts/mutations.ts'
import { getPosts } from '../../../../data/posts/store.ts'
import { routes } from '../../../../routes.ts'
import { adminMiddleware, requireAdminLogin } from '../../middleware.ts'
import { newPostDate, readPostForm } from '../form-values.ts'
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
      let { post: values } = form
      let result = await createPost(form)
      if (result.success) return redirect(routes.posts.show.href({ id: values.id }), 303)
      let files = isPostId(values.id) ? await listPostFiles(values.id) : []
      let { issues } = result
      return context.render(
        ...renderPostForm(context.request, { isNew: true, values, files, issues }),
      )
    },
  },
})
