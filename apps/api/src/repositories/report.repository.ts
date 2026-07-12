import type { Report, ReportStatus, ReportTargetType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export function create(input: {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
}): Promise<Report> {
  return prisma.report.create({ data: input });
}

export function findById(id: string): Promise<Report | null> {
  return prisma.report.findUnique({ where: { id } });
}

export function updateStatus(id: string, status: ReportStatus): Promise<Report> {
  return prisma.report.update({ where: { id }, data: { status } });
}

/** Admin queue — newest first, optionally filtered to one status. */
export function list(options: {
  status?: ReportStatus;
  cursor?: string;
  limit: number;
}): Promise<Report[]> {
  return prisma.report.findMany({
    where: options.status ? { status: options.status } : {},
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}
