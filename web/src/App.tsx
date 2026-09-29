import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/Dashboard';
import { InboxPage } from './pages/Inbox';
import { QuotesPage } from './pages/Quotes';
import { FollowupsPage } from './pages/Followups';
import { PaymentsPage } from './pages/Payments';
import { CustomersPage } from './pages/Customers';
import { ProductsPage } from './pages/Products';
import { PlaybooksPage } from './pages/Playbooks';
import { AgentsPage } from './pages/Agents';
import { SettingsPage } from './pages/Settings';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/inbox" element={<InboxPage />} />
      <Route path="/inbox/:id" element={<InboxPage />} />
      <Route path="/quotes" element={<QuotesPage />} />
      <Route path="/quotes/:id" element={<QuotesPage />} />
      <Route path="/followups" element={<FollowupsPage />} />
      <Route path="/payments" element={<PaymentsPage />} />
      <Route path="/customers" element={<CustomersPage />} />
      <Route path="/customers/:id" element={<CustomersPage />} />
      <Route path="/products" element={<ProductsPage />} />
      <Route path="/playbooks" element={<PlaybooksPage />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
