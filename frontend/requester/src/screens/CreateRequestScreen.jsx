import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { listUsers } from '@/api/users';
import { createRequest } from '@/api/requests';
import { toErrorView } from '@/api/client';
import { toUserOption } from '@/api/mappers';
import { useRequestStore } from '@/store/useRequestStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Zod schema AT THE UX BOUNDARY (R2). The domain/backend remains the
 * authoritative validator — this mirrors its rules so the form fails fast in
 * English, and any server-side rejection (400/404) is still surfaced.
 */
const createRequestSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required'),
    description: z.string().trim().min(1, 'Description is required'),
    amount: z.preprocess(
      // Empty input must fail as "required", not coerce to 0 and fail as
      // "positive" — mirrors the backend's number semantics.
      (v) => {
        if (v === '' || v === null || v === undefined) return NaN;
        return typeof v === 'number' ? v : Number(v);
      },
      z
        .number({ message: 'Amount is required' })
        .positive('Amount must be greater than 0')
        .refine(
          // Mirror the backend's exact rule (domain/values/Amount.ts):
          // Math.abs(value*100 - Math.round(value*100)) < 1e-9. The naive
          // `Number.isInteger(Math.round(v*100))` ALWAYS passes (Math.round
          // returns an integer), so 1.234 slipped through client-side.
          (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9,
          'Amount can have at most 2 decimal places'
        )
    ),
    requesterEmail: z.email('Requester is required'),
    approver1: z.email('Approver 1 is required'),
    approver2: z.email('Approver 2 is required'),
    approver3: z.email('Approver 3 is required'),
  })
  .superRefine((data, ctx) => {
    const approvers = [data.approver1, data.approver2, data.approver3];
    // Skip cross-field checks while values are still empty — the per-field
    // `required` issues already cover that case.
    if (approvers.some((email) => !email) || !data.requesterEmail) return;
    if (approvers.includes(data.requesterEmail)) {
      ctx.addIssue({
        code: 'custom',
        path: ['approvers'],
        message: 'An approver cannot be the requester',
      });
    }
    if (new Set(approvers).size !== 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['approvers'],
        message: 'Approvers must be distinct',
      });
    }
  });

const APPROVER_FIELDS = [
  { name: 'approver1', label: 'Approver 1' },
  { name: 'approver2', label: 'Approver 2' },
  { name: 'approver3', label: 'Approver 3' },
];

export default function CreateRequestScreen() {
  const navigate = useNavigate();
  const bumpListRefresh = useRequestStore((s) => s.bumpListRefresh);
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState(null);
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createRequestSchema),
    defaultValues: {
      title: '',
      description: '',
      amount: '',
      requesterEmail: '',
      approver1: '',
      approver2: '',
      approver3: '',
    },
  });

  const requesterEmail = watch('requesterEmail');

  useEffect(() => {
    let cancelled = false;
    listUsers()
      .then((list) => {
        if (!cancelled) setUsers(list.map(toUserOption));
      })
      .catch((err) => {
        if (!cancelled) setUsersError(toErrorView(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const formValues = watch();
  const selectedApprovers = APPROVER_FIELDS.map(({ name }) => formValues[name]).filter(
    (email) => !!email
  );

  /** R2: requester selector MUST NOT allow the same email as any approver. */
  const requesterOptions = useMemo(
    () => users.filter((u) => !selectedApprovers.includes(u.value)),
    [users, JSON.stringify(selectedApprovers)]
  );

  /** Approver selects: exclude the requester + approvers already picked. */
  const approverOptionsFor = (fieldName) => {
    const others = APPROVER_FIELDS.filter(({ name }) => name !== fieldName).map(
      ({ name }) => formValues[name]
    );
    return users.filter(
      (u) =>
        u.value !== formValues.requesterEmail && !others.includes(u.value)
    );
  };

  // If the requester changes and one of the approvers now collides, clear it
  // so the UI constraint holds without waiting for submit.
  const resetCollidingApprovers = (nextRequester) => {
    APPROVER_FIELDS.forEach(({ name }) => {
      if (formValues[name] === nextRequester) setValue(name, '');
    });
  };

  const onSubmit = async (values) => {
    setServerError(null);
    setSubmitting(true);
    try {
      const created = await createRequest({
        title: values.title,
        description: values.description,
        amount: values.amount,
        requesterEmail: values.requesterEmail,
        approverEmails: [values.approver1, values.approver2, values.approver3],
      });
      bumpListRefresh();
      // R2: on success, navigate to the new request's detail (relative to the
      // remote mount point: host /requester/{id}, standalone /{id}).
      navigate(`../${created.id}`);
    } catch (err) {
      setServerError(toErrorView(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>New purchase request</CardTitle>
      </CardHeader>
      <CardContent>
        {usersError && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            Could not load users: {usersError.message}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" {...register('title')} placeholder="e.g. New laptops" />
            {errors.title && (
              <p className="text-sm text-destructive" role="alert">
                {errors.title.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" {...register('description')} placeholder="What is being requested" />
            {errors.description && (
              <p className="text-sm text-destructive" role="alert">
                {errors.description.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount (USD)</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              {...register('amount')}
              placeholder="0.00"
            />
            {errors.amount && (
              <p className="text-sm text-destructive" role="alert">
                {errors.amount.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Requester</Label>
            <Controller
              control={control}
              name="requesterEmail"
              render={({ field }) => (
                <Select
                  value={field.value || undefined}
                  onValueChange={(value) => {
                    resetCollidingApprovers(value);
                    field.onChange(value);
                  }}
                >
                  <SelectTrigger aria-label="Requester">
                    <SelectValue placeholder="Select requester" />
                  </SelectTrigger>
                  <SelectContent>
                    {requesterOptions.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.requesterEmail && (
              <p className="text-sm text-destructive" role="alert">
                {errors.requesterEmail.message}
              </p>
            )}
          </div>

          {APPROVER_FIELDS.map(({ name, label }) => (
            <div className="space-y-2" key={name}>
              <Label>{label}</Label>
              <Controller
                control={control}
                name={name}
                render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger aria-label={label}>
                      <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {approverOptionsFor(name).map((u) => (
                        <SelectItem key={u.value} value={u.value}>
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors[name] && (
                <p className="text-sm text-destructive" role="alert">
                  {errors[name].message}
                </p>
              )}
            </div>
          ))}

          {errors.approvers && (
            <p className="text-sm text-destructive" role="alert">
              {errors.approvers.message}
            </p>
          )}

          {serverError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {serverError.message}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={submitting || usersError !== null}>
              {submitting ? 'Creating...' : 'Create request'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('..')}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
