import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import { MAX_UPLOAD_FILE_SIZE, MAX_UPLOAD_TOTAL_SIZE } from '../../../lib/constants.ts'
import { getTheme } from '../../../lib/theme.ts'
import { routes } from '../../../routes.ts'
import { Document } from '../../document.tsx'
import { AdminLogoutButton } from '../admin-page.tsx'
import {
  actionsStyle,
  buttonStyle,
  pageStyle,
  secondaryButtonStyle,
  titleStyle,
} from '../styles.ts'
import { DeletePostButton, DeletePostDialog } from './delete-post.tsx'
import { invalidCheck, type FormIssue, type PostFormValues } from './form-values.ts'
import { IssueList } from './issue-list.tsx'
import { CaptionField, DateFields, MediaFiles, TypePicker } from './post-fields.tsx'
import { ArticleFields, PhotosFields, VideoFields } from './type-fields.tsx'

interface PostFormPageProps {
  isNew: boolean
  values: PostFormValues
  // The post's files in media storage (see listPostFiles).
  files: { name: string; size: number }[]
  issues?: FormIssue[]
}

// The new or edit post page, with the submission's problems if it was rejected.
export function renderPostForm(
  request: Request,
  props: PostFormPageProps,
): [RemixNode, ResponseInit | undefined] {
  let { pathname } = new URL(request.url)
  return [
    <Document
      theme={getTheme(request)}
      meta={{ path: pathname, title: props.isNew ? 'New Post' : 'Edit Post', noindex: true }}
      navActions={<AdminLogoutButton />}
    >
      <PostFormPage {...props} />
    </Document>,
    props.issues ? { status: 400 } : undefined,
  ]
}

// The page for editing a post that doesn't exist.
export function renderPostNotFound(request: Request): [RemixNode, ResponseInit] {
  let { pathname } = new URL(request.url)
  return [
    <Document
      theme={getTheme(request)}
      meta={{ path: pathname, title: 'Post not found', noindex: true }}
      navActions={<AdminLogoutButton />}
    >
      <section mix={pageStyle}>
        <h1 mix={titleStyle}>Post not found</h1>
        <p>
          There’s no post with this id. <a href={routes.admin.index.href()}>See all posts</a>
        </p>
      </section>
    </Document>,
    { status: 404 },
  ]
}

// The page for a post form whose files are over the upload limits. Nothing in it was saved.
export function renderUploadTooLarge(request: Request): [RemixNode, ResponseInit] {
  let { pathname } = new URL(request.url)
  let mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`
  return [
    <Document
      theme={getTheme(request)}
      meta={{ path: pathname, title: 'Upload too large', noindex: true }}
      navActions={<AdminLogoutButton />}
    >
      <section mix={pageStyle}>
        <h1 mix={titleStyle}>Upload too large</h1>
        <p>
          Nothing was saved. Files can be up to {mb(MAX_UPLOAD_FILE_SIZE)} each, and{' '}
          {mb(MAX_UPLOAD_TOTAL_SIZE)} in one save. Go back and choose smaller files, or upload them
          over more than one save.
        </p>
      </section>
    </Document>,
    { status: 413 },
  ]
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
