// The pages under /admin, for managing the site: logging in and out (admin/login.tsx), the site's
// settings (admin/config.tsx), the list of posts and editing and deleting them (admin/posts.tsx),
// and the composer, where posts are written (admin/composer.tsx). Every handler only reads and
// sends commands; what a command does is in commands/.
import { HttpRouter } from 'effect/http'

import {
  compose,
  composerUpdates,
  discardComposer,
  postFile,
  previewComposer,
  publishComposer,
  updateComposerMedia,
} from './admin/composer.tsx'
import { saveConfig, showConfig } from './admin/config.tsx'
import { logIn, logOut, showLogin } from './admin/login.tsx'
import { deletePost, editPost, index, savePost } from './admin/posts.tsx'

export const AdminRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin', index),
  HttpRouter.route('GET', '/admin/login', showLogin),
  HttpRouter.route('POST', '/admin/login', logIn),
  HttpRouter.route('POST', '/admin/logout', logOut),
  HttpRouter.route('GET', '/admin/config', showConfig),
  HttpRouter.route('POST', '/admin/config', saveConfig),
  HttpRouter.route('GET', '/admin/posts/new', compose),
  HttpRouter.route('POST', '/admin/posts/new', publishComposer),
  HttpRouter.route('POST', '/admin/posts/new/media', updateComposerMedia),
  HttpRouter.route('POST', '/admin/posts/new/preview', previewComposer),
  HttpRouter.route('POST', '/admin/posts/new/discard', discardComposer),
  HttpRouter.route('GET', '/admin/posts/new/updates', composerUpdates),
  HttpRouter.route('GET', '/admin/posts/:id/files/:file', postFile),
  HttpRouter.route('GET', '/admin/posts/:id/edit', editPost),
  HttpRouter.route('POST', '/admin/posts/:id/edit', savePost),
  HttpRouter.route('POST', '/admin/posts/:id/delete', deletePost),
])
