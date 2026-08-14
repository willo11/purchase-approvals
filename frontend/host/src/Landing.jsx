import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <main>
      <h1>Purchase Approval Flow</h1>
      <nav>
        <ul>
          <li>
            <Link to="/solicitante">Solicitante</Link>
          </li>
          <li>
            <Link to="/approve">Approver</Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
