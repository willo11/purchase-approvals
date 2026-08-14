/**
 * A resolved registered employee returned by the {@link UserRegistryPort}.
 */
export interface RegistryUser {
  email: string;
  name: string;
}

/**
 * Read-only view over the user-registry used by the purchase-request core.
 *
 * The purchase-request capability only needs to resolve an email to its
 * registered name for snapshotting (design R1, Decision 8/16). It does not
 * mutate users — that is the user-registry capability's job. The DynamoDB
 * adapter lives in `infrastructure/`.
 */
export interface UserRegistryPort {
  /**
   * Resolves an email to its registered name, or `undefined` when the email is
   * not registered (mapped to HTTP 404 by the API layer).
   */
  findByEmail(email: string): Promise<RegistryUser | undefined>;
}