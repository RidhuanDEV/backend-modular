export interface Success<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface Failure {
  success: false;
  message: string;
  errors: string[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export function success<T>(data: T, meta?: PaginationMeta): Success<T> {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

export function pagination(page: number, limit: number, totalItems: number): PaginationMeta {
  const totalPages = Math.ceil(totalItems / limit);
  return { page, limit, totalItems, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 };
}
