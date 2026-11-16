type LogFields = Record<string, string | number | boolean>;

export const logger = {
  info(message: string, fields: LogFields = {}): void {
    console.info(
      JSON.stringify({
        level: 'info',
        time: new Date().toISOString(),
        message,
        ...fields,
      }),
    );
  },
  error(message: string, fields: LogFields = {}): void {
    console.error(
      JSON.stringify({
        level: 'error',
        time: new Date().toISOString(),
        message,
        ...fields,
      }),
    );
  },
};
