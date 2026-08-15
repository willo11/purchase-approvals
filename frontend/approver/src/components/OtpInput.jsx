import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * 6-digit OTP input (R2): numeric-only, max 6 characters, monospace-ish
 * tracking. Fully controlled — the parent owns the value.
 */
export default function OtpInput({ value, onChange, disabled = false, id = 'otp-code' }) {
  const handleChange = (event) => {
    // Strip anything that is not a digit and cap at 6 (R2: 6-digit code).
    const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
    onChange(digits);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>6-digit code</Label>
      <Input
        id={id}
        value={value}
        onChange={handleChange}
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        placeholder="000000"
        disabled={disabled}
        autoComplete="one-time-code"
        className="text-center text-lg tracking-[0.3em]"
      />
      <p className="text-xs text-muted-foreground">
        Enter the 6-digit code sent to your email.
      </p>
    </div>
  );
}
