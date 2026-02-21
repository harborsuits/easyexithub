import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import UnifiedDashboard from "./pages/UnifiedDashboard";
import PropertiesPage from "./pages/PropertiesPage";
import LeadsPage from "./pages/LeadsPage";
import LeadDetailPage from "./pages/LeadDetailPage";
import { PipelinePage } from "./pages/PipelinePage";
import DealsPage from "./pages/DealsPage";
import { BuyersPage } from "./pages/BuyersPage";
import ImportRunsPage from "./pages/ImportRunsPage";
import CallLogPage from "./pages/CallLogPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<UnifiedDashboard />} />
          <Route path="/properties" element={<PropertiesPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/deals" element={<DealsPage />} />
          <Route path="/buyers" element={<BuyersPage />} />
          <Route path="/imports" element={<ImportRunsPage />} />
          <Route path="/calls" element={<CallLogPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
