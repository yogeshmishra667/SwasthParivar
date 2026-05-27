import { QueryClient } from "@tanstack/react-query";

/**
 * App-wide query client. Defaults err on the side of *fewer* refetches
 * than the patient app — admins inspect specific data and don't want
 * the panel to re-fetch every time they tab away. Use `invalidateQueries`
 * after mutations to refresh.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
