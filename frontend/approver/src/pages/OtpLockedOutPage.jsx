import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * R2: informational lockout screen — shown after the 3rd wrong OTP (the
 * backend atomically invalidates the token, 403 LockedOutError). No actions:
 * the token is durably locked, so any further attempt is meaningless; the
 * requester must issue a new approval link.
 */
export default function OtpLockedOutPage() {
  return (
    <Card className="mx-auto mt-10 max-w-md">
      <CardHeader>
        <CardTitle>Access Locked</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Too many incorrect codes. This approval link has been locked. Please
          contact the requester for a new approval link.
        </p>
      </CardContent>
    </Card>
  );
}
