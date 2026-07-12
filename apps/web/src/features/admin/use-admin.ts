import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminAnalyticsSummaryDto,
  Page,
  ReportAction,
  ReportAdminDto,
  ReportStatus,
  TimeseriesPointDto,
} from '@pulsechat/shared';
import { get, patch } from '../../lib/api';

export function useAdminReports(status?: ReportStatus) {
  return useInfiniteQuery({
    queryKey: ['admin', 'reports', status ?? 'all'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (pageParam) params.set('cursor', pageParam);
      const qs = params.toString();
      return get<Page<ReportAdminDto>>(`/admin/reports${qs ? `?${qs}` : ''}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useReportAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: ReportAction }) =>
      patch<{ ok: true }>(`/admin/reports/${id}`, { action }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] });
    },
  });
}

export function useAdminSummary() {
  return useQuery({
    queryKey: ['admin', 'analytics', 'summary'],
    queryFn: () => get<AdminAnalyticsSummaryDto>('/admin/analytics/summary'),
    refetchInterval: 30_000,
  });
}

export function useAdminTimeseries(metric: 'signups' | 'sessions', range: 7 | 30 | 90) {
  return useQuery({
    queryKey: ['admin', 'analytics', 'timeseries', metric, range],
    queryFn: () =>
      get<{ items: TimeseriesPointDto[] }>(
        `/admin/analytics/timeseries?metric=${metric}&range=${range}`,
      ),
  });
}
