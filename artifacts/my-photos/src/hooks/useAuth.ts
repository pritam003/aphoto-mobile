import { useGetMe } from "@workspace/api-client-react";

export function useAuth() {
  const { data: user, isLoading, error } = useGetMe({
    query: {
      retry: false,
      staleTime: 5 * 60 * 1000,
      throwOnError: false,
    },
  });

  const isAuthenticated = !!user;

  return {
    user,
    isLoading,
    isAuthenticated,
    isUnauthenticated: !isLoading && !user,
    error,
  };
}
