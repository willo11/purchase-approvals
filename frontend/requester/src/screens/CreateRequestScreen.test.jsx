import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CreateRequestScreen from './CreateRequestScreen';
import { apiClient } from '@/api/client';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn() };
  return {
    __esModule: true,
    default: { create: () => mockInstance },
  };
});

const users = [
  { name: 'Carol', email: 'carol@x.com' },
  { name: 'Alice', email: 'alice@x.com' },
  { name: 'Bob', email: 'bob@x.com' },
  { name: 'Dana', email: 'dana@x.com' },
  { name: 'Evan', email: 'evan@x.com' },
];

// Detail stub: if the create screen navigates on success, this route renders.
function DetailStub() {
  return <div>detail-screen</div>;
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/new']}>
      <Routes>
        <Route path="/new" element={<CreateRequestScreen />} />
        <Route path="/:id" element={<DetailStub />} />
      </Routes>
    </MemoryRouter>
  );
}

async function fillForm(user) {
  await user.type(screen.getByLabelText('Title'), 'New laptops');
  await user.type(screen.getByLabelText('Description'), 'Gear for the team');
  await user.type(screen.getByLabelText('Amount (USD)'), '2500');

  await user.click(screen.getByRole('combobox', { name: 'Requester' }));
  await user.click(await screen.findByRole('option', { name: /Carol/ }));

  const approverSelects = ['Approver 1', 'Approver 2', 'Approver 3'];
  const approverEmails = ['alice@x.com', 'bob@x.com', 'dana@x.com'];
  for (let i = 0; i < approverSelects.length; i += 1) {
    await user.click(screen.getByRole('combobox', { name: approverSelects[i] }));
    const option = await screen.findByRole('option', {
      name: new RegExp(approverEmails[i]),
    });
    await user.click(option);
  }
}

describe('CreateRequestScreen (R2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: users });
  });

  test('R2: populates the requester and approver selectors from GET /api/users', async () => {
    const user = userEvent.setup();
    renderScreen();

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/users'));

    // Open the requester selector: all 5 registered users appear.
    await user.click(screen.getByRole('combobox', { name: 'Requester' }));
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(5);
  });

  test('R2: create succeeds and navigates to the new request detail', async () => {
    apiClient.post.mockResolvedValue({
      data: { id: 'r1', ...users[0] },
    });

    const user = userEvent.setup();
    renderScreen();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Create request' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/purchase-requests', {
        title: 'New laptops',
        description: 'Gear for the team',
        amount: 2500,
        requesterEmail: 'carol@x.com',
        approverEmails: ['alice@x.com', 'bob@x.com', 'dana@x.com'],
      });
    });

    expect(await screen.findByText('detail-screen')).toBeInTheDocument();
  });

  test('R2: validation error is shown and nothing is submitted', async () => {
    const user = userEvent.setup();
    renderScreen();

    // Submit the empty form directly.
    await user.click(screen.getByRole('button', { name: 'Create request' }));

    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(
      screen.getByText('Description is required')
    ).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  test('R2: requester cannot equal an approver (option excluded)', async () => {
    const user = userEvent.setup();
    renderScreen();

    // Pick Carol as requester, then open Approver 1 — Carol must not be
    // offered as an approver (requester != approvers constraint).
    await user.click(screen.getByRole('combobox', { name: 'Requester' }));
    await user.click(await screen.findByRole('option', { name: /Carol/ }));

    await user.click(screen.getByRole('combobox', { name: 'Approver 1' }));
    const options = await screen.findAllByRole('option');
    const labels = options.map((o) => o.textContent);
    expect(labels).toHaveLength(4);
    expect(labels.some((l) => l.includes('carol@x.com'))).toBe(false);
  });

  test('R2: server validation error is displayed and no navigation happens', async () => {
    apiClient.post.mockRejectedValue({
      response: {
        status: 400,
        data: { error: 'Validation', message: 'Approver email not registered' },
      },
    });

    const user = userEvent.setup();
    renderScreen();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Create request' }));

    expect(
      await screen.findByText('Approver email not registered')
    ).toBeInTheDocument();
    expect(screen.queryByText('detail-screen')).not.toBeInTheDocument();
  });

  test('R5: users endpoint failure is surfaced without crashing', async () => {
    apiClient.get.mockRejectedValue({
      response: { status: 500, data: { error: 'Internal', message: 'Users boom' } },
    });

    renderScreen();

    expect(
      await screen.findByText(/Could not load users: Users boom/)
    ).toBeInTheDocument();
  });
});
