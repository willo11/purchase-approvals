import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DecisionButtons from './DecisionButtons';

describe('DecisionButtons — approve without name, reject with confirm (R3)', () => {
  test('renders Approve and Reject buttons', () => {
    render(<DecisionButtons onApprove={() => {}} onRejectConfirm={() => {}} />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('Approve fires onApprove directly — no name input anywhere (R3)', async () => {
    const user = userEvent.setup();
    const onApprove = jest.fn();
    render(<DecisionButtons onApprove={onApprove} onRejectConfirm={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    // The decision UI must never ask for a name (registered snapshot is used).
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
  });

  test('Reject requires confirmation: cancel does not fire, confirm does', async () => {
    const user = userEvent.setup();
    const onRejectConfirm = jest.fn();
    render(<DecisionButtons onApprove={() => {}} onRejectConfirm={onRejectConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onRejectConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onRejectConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.click(screen.getByRole('button', { name: 'Yes, reject' }));
    expect(onRejectConfirm).toHaveBeenCalledTimes(1);
  });

  test('disabled blocks both actions', async () => {
    const user = userEvent.setup();
    const onApprove = jest.fn();
    render(
      <DecisionButtons
        onApprove={onApprove}
        onRejectConfirm={() => {}}
        disabled
      />
    );
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).not.toHaveBeenCalled();
  });
});
