import { useState } from 'react';
import OtpInput from '@/components/OtpInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useValidateOtp } from '@/hooks/useValidateOtp';
import { useApprovalFlowStore } from '@/store/useApprovalFlowStore';

/**
 * R2 — OTP entry screen.
 *
 * Normal state: a 6-digit input + Verify. Wrong code → the API's
 * `{ attemptsRemaining }` (401) is shown and the screen stays; a 3rd failure
 * locks the token (403) and the landing container swaps to the lockout
 * screen. Expired (410 ExpiredOtpError) → "Generate new OTP" restarts entry
 * with a fresh 3-minute window (endpoint #9).
 */
export default function OtpEntryPage() {
  const expiresInSeconds = useApprovalFlowStore((s) => s.expiresInSeconds);
  const { submitting, error, expired, regenerating, submit, regenerate } =
    useValidateOtp();
  const [code, setCode] = useState('');
  const [regenerated, setRegenerated] = useState(false);

  const minutes = expiresInSeconds ? Math.round(expiresInSeconds / 60) : 3;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (code.length !== 6 || submitting) return;
    submit(code);
  };

  const handleRegenerate = async () => {
    const freshSeconds = await regenerate();
    if (freshSeconds != null) {
      setCode('');
      setRegenerated(true);
    }
  };

  if (expired) {
    return (
      <Card className="mx-auto mt-10 max-w-md">
        <CardHeader>
          <CardTitle>Your code has expired</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Generate a new 6-digit code. It will be sent to your email and is
            valid for {minutes} minute{minutes === 1 ? '' : 's'}.
          </p>
          <Button onClick={handleRegenerate} disabled={regenerating}>
            {regenerating ? 'Generating...' : 'Generate new OTP'}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto mt-10 max-w-md">
      <CardHeader>
        <CardTitle>Enter your code</CardTitle>
        <p className="text-sm text-muted-foreground">
          A 6-digit code was sent to your email. It expires in {minutes} minute
          {minutes === 1 ? '' : 's'}.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <OtpInput value={code} onChange={setCode} disabled={submitting} />
          {error && error.status === 401 && (
            <p role="alert" className="text-sm text-destructive">
              Incorrect code.{' '}
              {error.attemptsRemaining === 1
                ? '1 attempt remaining.'
                : `${error.attemptsRemaining ?? 0} attempts remaining.`}
            </p>
          )}
          {error && error.status !== 401 && (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}
          {regenerated && (
            <p role="status" className="text-sm text-emerald-600">
              A new code has been sent.
            </p>
          )}
          <Button type="submit" disabled={submitting || code.length !== 6}>
            {submitting ? 'Verifying...' : 'Verify code'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
