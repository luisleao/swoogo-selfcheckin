export interface FirebaseIdTokenProvider {
  getIdToken: () => Promise<string | null>;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  onUnauthorized?: () => void;
  tokenProvider: FirebaseIdTokenProvider;
}

export interface ApiRequestOptions<TBody = unknown> {
  body?: TBody;
  headers?: HeadersInit;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  signal?: AbortSignal;
}

export class ApiError extends Error {
  readonly details: unknown;
  readonly status: number;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ApiError";
    this.details = details;
    this.status = status;
  }
}

export interface ApiClient {
  delete: <TResponse>(path: string, options?: Omit<ApiRequestOptions, "method">) => Promise<TResponse>;
  get: <TResponse>(path: string, options?: Omit<ApiRequestOptions, "method" | "body">) => Promise<TResponse>;
  patch: <TResponse, TBody = unknown>(
    path: string,
    body: TBody,
    options?: Omit<ApiRequestOptions<TBody>, "method" | "body">
  ) => Promise<TResponse>;
  post: <TResponse, TBody = unknown>(
    path: string,
    body: TBody,
    options?: Omit<ApiRequestOptions<TBody>, "method" | "body">
  ) => Promise<TResponse>;
  put: <TResponse, TBody = unknown>(
    path: string,
    body: TBody,
    options?: Omit<ApiRequestOptions<TBody>, "method" | "body">
  ) => Promise<TResponse>;
  request: <TResponse, TBody = unknown>(
    path: string,
    options?: ApiRequestOptions<TBody>
  ) => Promise<TResponse>;
}

interface ApiSuccessEnvelope<TData = unknown> {
  data: TData;
  ok: true;
  requestId?: string;
}

const isAbsoluteUrl = (path: string) => /^https?:\/\//i.test(path);

const buildUrl = (baseUrl: string, path: string) => {
  if (isAbsoluteUrl(path)) {
    return path;
  }

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
};

const readResponseBody = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? "";

  if (response.status === 204) {
    return undefined;
  }

  if (contentType.includes("application/json")) {
    return response.json() as Promise<unknown>;
  }

  return response.text();
};

const errorMessageFromBody = (body: unknown, fallback: string) => {
  if (typeof body === "object" && body && "error" in body) {
    const errorValue = (body as { error?: unknown }).error;

    if (typeof errorValue === "string" && errorValue.trim()) {
      return errorValue;
    }

    if (typeof errorValue === "object" && errorValue && "message" in errorValue) {
      const message = (errorValue as { message?: unknown }).message;

      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  }

  return fallback;
};

const isSuccessEnvelope = <TResponse>(body: unknown): body is ApiSuccessEnvelope<TResponse> => {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { ok?: unknown }).ok === true &&
    Object.prototype.hasOwnProperty.call(body, "data")
  );
};

export const createApiClient = ({
  baseUrl,
  fetcher = fetch,
  onUnauthorized,
  tokenProvider,
}: ApiClientOptions): ApiClient => {
  const request = async <TResponse, TBody = unknown>(
    path: string,
    options: ApiRequestOptions<TBody> = {}
  ): Promise<TResponse> => {
    const token = await tokenProvider.getIdToken();
    const headers = new Headers(options.headers);

    headers.set("Accept", "application/json");

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const init: RequestInit = {
      headers,
      method: options.method ?? "GET",
      signal: options.signal,
    };

    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(options.body);
    }

    const response = await fetcher(buildUrl(baseUrl, path), init);
    const body = await readResponseBody(response);

    if (response.status === 401) {
      onUnauthorized?.();
    }

    if (!response.ok) {
      throw new ApiError(
        errorMessageFromBody(body, `Request failed with status ${response.status}`),
        response.status,
        body
      );
    }

    if (isSuccessEnvelope<TResponse>(body)) {
      return body.data;
    }

    return body as TResponse;
  };

  return {
    delete: (path, options) => request(path, { ...options, method: "DELETE" }),
    get: (path, options) => request(path, { ...options, method: "GET" }),
    patch: (path, body, options) => request(path, { ...options, body, method: "PATCH" }),
    post: (path, body, options) => request(path, { ...options, body, method: "POST" }),
    put: (path, body, options) => request(path, { ...options, body, method: "PUT" }),
    request,
  };
};
