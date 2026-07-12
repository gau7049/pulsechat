import { useMutation } from '@tanstack/react-query';
import type { CreateReportBody } from '@pulsechat/shared';
import { post } from '../../lib/api';

/** POST /reports (Requirement Scope §18) — file a report on a post/message/profile. */
export function useReport() {
  return useMutation({
    mutationFn: (body: CreateReportBody) => post<{ ok: true }>('/reports', body),
  });
}
