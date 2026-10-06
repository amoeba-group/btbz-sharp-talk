import { lazy, Suspense } from 'react';
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useLocation,
  useParams,
} from 'react-router-dom';
import { tenantLoginPath } from '@/lib/tenant-path';
import { Loader2 } from 'lucide-react';
import { AppLayout } from '@/layouts/AppLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { LandingPage } from '@/domain/landing/LandingPage';
import { TenantLoginPage } from '@/domain/auth/TenantLoginPage';
import { AdminLoginPage } from '@/domain/auth/AdminLoginPage';

// Route-level code splitting (PERF-13): each page ships as its own chunk so
// the initial bundle is the shell + public pages, not every admin screen at
// once. The landing/login pages stay eager for a fast first paint.
const DashboardPage = lazy(() => import('@/domain/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const LiveChatPage = lazy(() => import('@/domain/live-chat/LiveChatPage').then((m) => ({ default: m.LiveChatPage })));
const IssueBoardPage = lazy(() => import('@/domain/issues/IssueBoardPage').then((m) => ({ default: m.IssueBoardPage })));
const HistoryPage = lazy(() => import('@/domain/history/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const JourneyBoardPage = lazy(() =>
  import('@/domain/journey/JourneyBoardPage').then((m) => ({ default: m.JourneyBoardPage })),
);
const WorkLogPage = lazy(() => import('@/domain/work-log/WorkLogPage').then((m) => ({ default: m.WorkLogPage })));
const StatisticsPage = lazy(() => import('@/domain/statistics/StatisticsPage').then((m) => ({ default: m.StatisticsPage })));
const AiSettingsPage = lazy(() => import('@/domain/ai-settings/AiSettingsPage').then((m) => ({ default: m.AiSettingsPage })));
const KnowledgePage = lazy(() => import('@/domain/knowledge/KnowledgePage').then((m) => ({ default: m.KnowledgePage })));
const BoardListPage = lazy(() => import('@/domain/board/BoardListPage').then((m) => ({ default: m.BoardListPage })));
const BoardDocumentPage = lazy(() => import('@/domain/board/BoardDocumentPage').then((m) => ({ default: m.BoardDocumentPage })));
const CustomersPage = lazy(() => import('@/domain/customers/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const OrdersPage = lazy(() => import('@/domain/orders/OrdersPage').then((m) => ({ default: m.OrdersPage })));
const ProductsPage = lazy(() => import('@/domain/products/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const MenuPage = lazy(() => import('@/domain/menu/MenuPage').then((m) => ({ default: m.MenuPage })));
const CampaignsPage = lazy(() => import('@/domain/campaigns/CampaignsPage').then((m) => ({ default: m.CampaignsPage })));
const ReviewsPage = lazy(() => import('@/domain/reviews/ReviewsPage').then((m) => ({ default: m.ReviewsPage })));
const UsersPage = lazy(() => import('@/domain/users/UsersPage').then((m) => ({ default: m.UsersPage })));
const SettingsPage = lazy(() => import('@/domain/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SettingsLayout = lazy(() => import('@/domain/settings/SettingsLayout').then((m) => ({ default: m.SettingsLayout })));
const SettingsBasicPage = lazy(() => import('@/domain/settings/SettingsBasicPage').then((m) => ({ default: m.SettingsBasicPage })));
const SettingsWidgetPage = lazy(() => import('@/domain/settings/SettingsWidgetPage').then((m) => ({ default: m.SettingsWidgetPage })));
const SettingsPlatformsPage = lazy(() => import('@/domain/settings/SettingsPlatformsPage').then((m) => ({ default: m.SettingsPlatformsPage })));
const SettingsMarketingPage = lazy(() => import('@/domain/settings/SettingsMarketingPage').then((m) => ({ default: m.SettingsMarketingPage })));
const SettingsMessengersPage = lazy(() => import('@/domain/settings/SettingsMessengersPage').then((m) => ({ default: m.SettingsMessengersPage })));
const SettingsEtcPage = lazy(() => import('@/domain/settings/SettingsEtcPage').then((m) => ({ default: m.SettingsEtcPage })));
const PrivacyNoticePage = lazy(() => import('@/domain/privacy-notice/PrivacyNoticePage').then((m) => ({ default: m.PrivacyNoticePage })));
const MyPage = lazy(() => import('@/domain/my-page/MyPage').then((m) => ({ default: m.MyPage })));
const AdminOverviewPage = lazy(() => import('@/domain/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })));
const TenantsPage = lazy(() => import('@/domain/admin/TenantsPage').then((m) => ({ default: m.TenantsPage })));
const TenantUsersPage = lazy(() => import('@/domain/admin/TenantUsersPage').then((m) => ({ default: m.TenantUsersPage })));
const AdminUsersPage = lazy(() => import('@/domain/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })));
const AiEnginesPage = lazy(() => import('@/domain/admin/AiEnginesPage').then((m) => ({ default: m.AiEnginesPage })));
const AuditPage = lazy(() => import('@/domain/admin/AuditPage').then((m) => ({ default: m.AuditPage })));

/** Chunk-load fallback: neutral spinner (no text — nothing to localize). */
function PageFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  );
}

/**
 * Legacy `/<slug>` → `/user/<slug>` (PLN-260824 S1), kept indefinitely so old
 * bookmarks, manual links and the AMA portal iframe keep working. Search and
 * hash are preserved — the ?ama_token= SSO handoff must survive the hop (its
 * scrubbing runs on the target page).
 */
function LegacySlugRedirect() {
  const { tenantSlug = '' } = useParams<{ tenantSlug: string }>();
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: tenantLoginPath(tenantSlug), search, hash }} replace />;
}

// Public: landing at /, system-admin login at /admin/login, per-tenant login
// at /user/:tenantSlug (legacy /:tenantSlug redirects there). Static segments
// outrank the :tenantSlug param, so every console route below stays reachable;
// slugs matching them are rejected server-side (RESERVED_TENANT_SLUGS).
const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/admin/login', element: <AdminLoginPage /> },
  {
    element: (
      <ProtectedRoute actorType="user">
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/menu', element: <MenuPage /> },
      { path: '/live-chat', element: <LiveChatPage /> },
      { path: '/issues', element: <IssueBoardPage /> },
      { path: '/history', element: <HistoryPage /> },
      { path: '/journey', element: <JourneyBoardPage /> },
      { path: '/work-log', element: <WorkLogPage /> },
      { path: '/statistics', element: <StatisticsPage /> },
      { path: '/ai-setting', element: <AiSettingsPage /> },
      { path: '/knowledge', element: <KnowledgePage /> },
      { path: '/knowledge/board', element: <BoardListPage /> },
      { path: '/knowledge/board/:id', element: <BoardDocumentPage /> },
      { path: '/customers', element: <CustomersPage /> },
      { path: '/orders', element: <OrdersPage /> },
      { path: '/products', element: <ProductsPage /> },
      { path: '/campaigns', element: <CampaignsPage /> },
      { path: '/reviews', element: <ReviewsPage /> },
      { path: '/users', element: <UsersPage /> },
      {
        path: '/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <SettingsPage /> },
          { path: 'basic', element: <SettingsBasicPage /> },
          { path: 'widget', element: <SettingsWidgetPage /> },
          { path: 'platforms', element: <SettingsPlatformsPage /> },
          { path: 'marketing', element: <SettingsMarketingPage /> },
          { path: 'messengers', element: <SettingsMessengersPage /> },
          { path: 'etc', element: <SettingsEtcPage /> },
          // Same page as before, reached as a tab now.
          { path: 'privacy', element: <PrivacyNoticePage /> },
        ],
      },
      // Moved into settings; the old link is kept so bookmarks survive.
      { path: '/privacy-notice', element: <Navigate to="/settings/privacy" replace /> },
      { path: '/my-page', element: <MyPage /> },
    ],
  },
  {
    path: '/admin',
    element: (
      <ProtectedRoute actorType="admin">
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <AdminOverviewPage /> },
      { path: 'menu', element: <MenuPage /> },
      { path: 'tenants', element: <TenantsPage /> },
      { path: 'tenants/:tenantUuid/users', element: <TenantUsersPage /> },
      { path: 'admins', element: <AdminUsersPage /> },
      { path: 'ai-engines', element: <AiEnginesPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'my-page', element: <MyPage /> },
    ],
  },
  { path: '/user/:tenantSlug', element: <TenantLoginPage /> },
  { path: '/:tenantSlug', element: <LegacySlugRedirect /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function AppRouter() {
  return (
    <Suspense fallback={<PageFallback />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
