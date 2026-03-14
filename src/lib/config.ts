export const config = {
  get apiToken(): string {
    const token = process.env.API_TOKEN;
    if (!token) throw new Error("API_TOKEN environment variable is required");
    return token;
  },
  get databaseUrl(): string {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL environment variable is required");
    return url;
  },
};
