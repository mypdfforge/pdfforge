export class ConversionError extends Error {
  constructor(message: string, public readonly stage: string, public readonly page?: number) {
    super(`[${stage}${page !== undefined ? ` p${page}` : ''}] ${message}`);
    this.name = 'ConversionError';
  }
}

export class IngestError extends ConversionError {
  constructor(message: string, page?: number) {
    super(message, 'Ingest', page);
  }
}

export class DLAError extends ConversionError {
  constructor(message: string, page?: number) {
    super(message, 'DLA', page);
  }
}

export class EmitError extends ConversionError {
  constructor(message: string) {
    super(message, 'Emit');
  }
}

export class ValidationError extends ConversionError {
  constructor(message: string) {
    super(message, 'Validation');
  }
}
