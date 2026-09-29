export interface JwtUserPayload {
  id: string;
  email: string;
  roleId: string;
  exp?: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
