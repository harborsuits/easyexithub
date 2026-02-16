import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CRMProvider } from "@/context/CRMContext";
import { LeadsProvider } from "@/context/LeadsContextV2";
import Index from "./pages/Index";
import { PipelinePage } from "./pages/PipelinePage";
import { BuyersPage } from "./pages/BuyersPage";
import LeadsPage from "./pages/LeadsPage";
import LeadDetailPage from "./pages/LeadDetailPage";
import DealsPage from "./pages/DealsPage";
import ImportLeadsPage from "./pages/ImportLeadsPage";
import UnifiedDashboard from "./pages/UnifiedDashboard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <CRMProvider>
        <LeadsProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
          <Routes>
            <Route path="/" element={<UnifiedDashboard />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/buyers" element={<BuyersPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/leads/:id" element={<LeadDetailPage />} />
            <Route path="/deals" element={<DealsPage />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        </LeadsProvider>
      </CRMProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
