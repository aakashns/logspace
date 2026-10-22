import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type { PostIssue } from '../../../data/posts/model.ts'
import { routes } from '../../../routes.ts'
import { renderAdminMessage, renderAdminPage } from '../ui/page.tsx'
import {
  actionsStyle,
  buttonStyle,
  pageStyle,
  secondaryButtonStyle,
  titleStyle,
} from '../ui/styles.ts'
import { DeletePostButton, DeletePostDialog } from './delete-post.tsx'
import { invalidCheck, type PostFormValues } from './form-values.ts'
import { IssueList } from './issue-list.tsx'
import { CaptionField, DateFields, MediaFiles, TypePicker } from './post-fields.tsx'
import { ArticleFields, PhotosFields, VideoFields } from './type-fields.tsx'

interface PostFormPageProps {
  isNew: boolean
  values: PostFormValues
  // The post's files in media storage (see listPostFiles).
  files: { name: string; size: number }[]
  issues?: PostIssue[]
}

// The new or edit post page, with the submission's problems if it was rejected.
export function renderPostForm(request: Request, props: PostFormPageProps) {
  let title = props.isNew ? 'New Post' : 'Edit Post'
  return renderAdminPage(
    request,
    title,
    <PostFormPage {...props} />,
    props.issues && { status: 400 },
  )
}

// The page for editing a post that doesn't exist.
export function renderPostNotFound(request: Request) {
  let message = (
    <>
      There’s no post with this id. <a href={routes.admin.index.href()}>See all posts</a>
    </>
  )
  return renderAdminMessage(request, 'Post not found', message, { status: 404 })
}

function PostFormPage(handle: Handle<PostFormPageProps>) {
  return () => {
    let { isNew, values, files, issues = [] } = handle.props
    let action = isNew
      ? routes.admin.posts.new.action.href()
      : routes.admin.posts.edit.action.href({ id: values.id })
    let fieldProps = { values, invalid: invalidCheck(issues), isNew }
    // The new post page has every type's fields; an existing post's only has its own type's.
    let hasFields = (type: string) => isNew || values.type === type

    return (
      <section mix={pageStyle}>
        <h1 mix={titleStyle}>{isNew ? 'New Post' : 'Edit Post'}</h1>
        {issues.length > 0 ? <IssueList issues={issues} /> : null}

        <form method="post" action={action} enctype="multipart/form-data" mix={formStyle}>
          {isNew ? <input type="hidden" name="id" value={values.id} /> : null}
          <TypePicker isNew={isNew} type={values.type} />
          <DateFields {...fieldProps} />
          <CaptionField {...fieldProps} />
          <MediaFiles id={values.id} isNew={isNew} files={files} />
          {hasFields('photos') ? <PhotosFields {...fieldProps} /> : null}
          {hasFields('video') ? <VideoFields {...fieldProps} /> : null}
          {hasFields('article') ? <ArticleFields {...fieldProps} /> : null}

          <div mix={actionsStyle}>
            <button type="submit" mix={buttonStyle}>
              {isNew ? 'Publish' : 'Save'}
            </button>
            <a href={routes.admin.index.href()} mix={secondaryButtonStyle}>
              Cancel
            </a>
            {isNew ? null : <DeletePostButton />}
          </div>
        </form>

        {isNew ? null : <DeletePostDialog id={values.id} />}
      </section>
    )
  }
}

const formStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
})
