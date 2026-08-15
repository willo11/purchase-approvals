/**
 * Requester remote route paths, RELATIVE to the host mount point (/requester*):
 *   "/"    → list   (host: /requester)
 *   "/new" → create (host: /requester/new)
 *   "/:id" → detail (host: /requester/:id)
 * Pages navigate relatively (e.g. `../${id}`, `new`) so they stay correct
 * regardless of the mount point; only the top-level route patterns live here.
 */
export const ROUTE_PATHS = {
  list: '/',
  create: '/new',
  detail: '/:id',
};
