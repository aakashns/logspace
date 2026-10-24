// The pages under /admin, for managing the site: logging in and out (admin/login.tsx), the site's
// settings (admin/config.tsx), the list of posts (admin/posts.tsx), and the composer, where posts
// are written, edited, and deleted (admin/composer.tsx). Every handler only reads and sends
// commands; what a command does is in commands/.
import { HttpRouter } from 'effect/http'

import {
  compose,
  deletePost,
  discardComposer,
  editPost,
  postFile,
  previewComposer,
  saveComposer,
  updateComposerMedia,
} from './admin/composer.tsx'
import { saveConfig, showConfig } from './admin/config.tsx'
import { logIn, logOut, showLogin } from './admin/login.tsx'
import { index } from './admin/posts.tsx'

export const AdminRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin', index),
  HttpRouter.route('GET', '/admin/login', showLogin),
  HttpRouter.route('POST', '/admin/login', logIn),
  HttpRouter.route('POST', '/admin/logout', logOut),
  HttpRouter.route('GET', '/admin/config', showConfig),
  HttpRouter.route('POST', '/admin/config', saveConfig),
  HttpRouter.route('GET', '/admin/posts/new', compose),
  HttpRouter.route('GET', '/admin/posts/:id/edit', editPost),
  HttpRouter.route('POST', '/admin/posts', saveComposer),
  HttpRouter.route('POST', '/admin/posts/discard', discardComposer),
  HttpRouter.route('POST', '/admin/posts/media', updateComposerMedia),
  HttpRouter.route('POST', '/admin/posts/preview', previewComposer),
  HttpRouter.route('GET', '/admin/posts/:id/files/:file', postFile),
  HttpRouter.route('POST', '/admin/posts/:id/delete', deletePost),
])
