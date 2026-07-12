import { Router } from 'express';
import {
  createCommentSchema,
  createPostSchema,
  postsQuerySchema,
  type CreateCommentBody,
  type CreatePostBody,
  type PaginationQuery,
} from '@pulsechat/shared';
import * as postService from '../../services/post.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { param, validateBody, validateQuery } from '../middleware/validate.js';

/** Posts, comments, likes, saves (Requirement Scope §13). */
export const postsRouter: Router = Router();

postsRouter.use('/posts', requireAuth, apiLimiter);

/** §13.5 "Posts I've Liked" / "Saved Posts" — registered before /posts/:id routes. */
postsRouter.get('/posts/liked', validateQuery(postsQuerySchema), async (req, res) => {
  const query = req.validatedQuery as PaginationQuery;
  res.json(await postService.listLikedPosts(req.auth!.sub, query));
});

postsRouter.get('/posts/saved', validateQuery(postsQuerySchema), async (req, res) => {
  const query = req.validatedQuery as PaginationQuery;
  res.json(await postService.listSavedPosts(req.auth!.sub, query));
});

postsRouter.post('/posts', validateBody(createPostSchema), async (req, res) => {
  const body = req.body as CreatePostBody;
  res.status(201).json({ post: await postService.createPost(req.auth!.sub, body) });
});

postsRouter.get('/posts/:id', async (req, res) => {
  res.json({ post: await postService.getPost(req.auth!.sub, param(req, 'id')) });
});

postsRouter.delete('/posts/:id', async (req, res) => {
  await postService.deletePost(req.auth!.sub, param(req, 'id'));
  res.json({ ok: true });
});

postsRouter.get('/posts/:id/comments', validateQuery(postsQuerySchema), async (req, res) => {
  const query = req.validatedQuery as PaginationQuery;
  res.json(await postService.listComments(req.auth!.sub, param(req, 'id'), query));
});

postsRouter.post('/posts/:id/comments', validateBody(createCommentSchema), async (req, res) => {
  const { body: commentBody } = req.body as CreateCommentBody;
  res.status(201).json({
    comment: await postService.createComment(req.auth!.sub, param(req, 'id'), commentBody),
  });
});

postsRouter.post('/posts/:id/like', async (req, res) => {
  res.json(await postService.toggleLike(req.auth!.sub, param(req, 'id')));
});

postsRouter.post('/posts/:id/save', async (req, res) => {
  res.json(await postService.toggleSave(req.auth!.sub, param(req, 'id')));
});
