import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isApiError } from "../services/api";
import type { LoginInput, Me, PasswordChangeInput, ProfileUpdateInput, RegisterInput, WalletCreateInput } from "../services/types";
import { keys } from "./keys";

/**
 * Drop every cached query except the session itself. (`queryClient.clear()` would also detach the live
 * `me` observer, so route guards wouldn't see the new session.)
 */
function resetUserCaches(qc: ReturnType<typeof useQueryClient>, me: Me | null) {
  qc.cancelQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
  qc.setQueryData(keys.me, me);
}

/** Current session. Resolves to `null` (not an error) when the visitor is not logged in. */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.auth.me();
      } catch (e) {
        if (isApiError(e) && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: (count, e) => !(isApiError(e) && e.status < 500) && count < 2,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginInput) => api.auth.login(body),
    onSuccess: (me) => resetUserCaches(qc, me),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterInput) => api.auth.register(body),
    onSuccess: (me) => resetUserCaches(qc, me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.auth.logout(),
    onSettled: () => resetUserCaches(qc, null),
  });
}

export function useCreateWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WalletCreateInput) => api.wallet.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.me });
      qc.invalidateQueries({ queryKey: keys.notifications });
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileUpdateInput) => api.profile.update(body),
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me);
    },
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PasswordChangeInput) => api.profile.changePassword(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}
