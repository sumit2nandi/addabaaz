// Persistence error translation helpers. Callers depend on this stable error contract, not mysql2.
export const isDuplicate = (error) => error?.code === 'ER_DUP_ENTRY';
