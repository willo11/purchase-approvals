import { apiClient } from './client';

/**
 * Users API — endpoint #2 of design-api.md.
 * GET /api/users → User[] in creation order.
 * User { name, email, position? }
 */
export async function listUsers() {
  const { data } = await apiClient.get('/api/users');
  return data;
}
