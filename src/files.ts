import { Effect, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { z } from "zod";
import { EditPath, FailureCode, FileEdit, failureMessages, UploadMode, uploadLimit } from "./file-contract.js";
import { AccessDenied, Identity, IdentityError } from "./identity.js";
import { Workspace } from "./workspace.js";
import { downloadFile, editWorkspace, FileProblem, listDirectory, listPaths, previewFile, uploadFile } from "./workspace-files.js";

class FileFailure extends Schema.TaggedError<FileFailure>()("FileFailure", { code: Schema.String }) {}

const statuses = { FILE_EXISTS: 409, FILE_TOO_LARGE: 413, PATH_NOT_ALLOWED: 400, NOT_FOUND: 404, INVALID: 400 } satisfies Record<FailureCode, number>;

const missing = z.object({ code: z.literal("ENOENT") });

const Query = z.object({ path: z.string().max(1024).default(""), hidden: z.string().optional() });

const UploadQuery = z.object({ path: EditPath, mode: UploadMode.default("fail") });

// A directory path as segments; "" is the workspace root.
const segments = (relative: string) => {
  const parts = relative === "" ? [] : relative.split("/");

  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) throw new FileProblem("INVALID");

  return parts;
};

export const FileRoutes = HttpRouter.use(Effect.fn("Files.routes")(function* (router) {
  const identity = yield* Identity;
  const paths = yield* Workspace;
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const cookie = identity.secureCookie ? "__Host-camenae" : "camenae-local";
  const json = <T,>(value: T, status = 200) => HttpServerResponse.jsonUnsafe(value, { status, headers });

  const run = <A,>(work: () => Promise<A>) => Effect.tryPromise({
    try: work,
    catch: (error) => {
      if (error instanceof FileProblem) return new FileFailure({ code: error.code });

      return new FileFailure({ code: missing.safeParse(error).success ? "NOT_FOUND" : "INVALID" });
    },
  });

  // Session cookie only; writes add the Origin and CSRF checks below.
  const session = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const token = request.cookies[cookie] ?? "";
    yield* identity.session(token);

    return { request, token, query: new URL(request.url, "http://camenae.invalid").searchParams };
  });

  const guarded = (request: HttpServerRequest.HttpServerRequest, expected: string) => request.headers.origin === identity.origin && request.headers["content-type"]?.split(";")[0] === expected
    ? Effect.void : Effect.fail(new FileFailure({ code: "INVALID" }));

  const handled = (handler: Effect.Effect<HttpServerResponse.HttpServerResponse, FileFailure | AccessDenied | IdentityError,
    HttpServerRequest.HttpServerRequest>) => handler.pipe(Effect.catchTags({
    AccessDenied: () => Effect.succeed(HttpServerResponse.text("Sign in again", { status: 401, headers })),
    IdentityError: () => Effect.succeed(HttpServerResponse.text("Unavailable", { status: 503, headers })),
    FileFailure: (failure) => {
      const parsed = FailureCode.safeParse(failure.code);
      const code = parsed.success ? parsed.data : "INVALID";

      return Effect.succeed(json({ code, message: failureMessages[code] }, statuses[code]));
    },
  }));

  const list = Effect.gen(function* () {
    const { query } = yield* session;
    const parsed = Query.safeParse(Object.fromEntries(query));

    if (!parsed.success) return yield* new FileFailure({ code: "INVALID" });
    const { path, hidden } = parsed.data;

    return json(yield* run(() => listDirectory(paths.workspace, segments(path), hidden === "1")));
  });

  const everything = Effect.gen(function* () {
    yield* session;

    return json(yield* run(() => listPaths(paths.workspace)));
  });

  const preview = Effect.gen(function* () {
    const { query } = yield* session;

    return json(yield* run(() => previewFile(paths.workspace, query.get("path") ?? "")));
  });

  const download = Effect.gen(function* () {
    const { query } = yield* session;
    const file = yield* run(() => downloadFile(paths.workspace, query.get("path") ?? ""));

    return HttpServerResponse.uint8Array(file.bytes, { contentType: "application/octet-stream",
      headers: { ...headers, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` } });
  });

  // Raw bytes, CSRF in a header: the browser sends the file itself, not a JSON copy of it.
  const upload = Effect.gen(function* () {
    const { request, token, query } = yield* session;
    yield* guarded(request, "application/octet-stream");
    yield* identity.authorize(token, request.headers["x-camenae-csrf"] ?? "");
    const parsed = UploadQuery.safeParse(Object.fromEntries(query));

    if (!parsed.success) return yield* new FileFailure({ code: "INVALID" });

    if (Number(request.headers["content-length"] ?? 0) > uploadLimit) return yield* new FileFailure({ code: "FILE_TOO_LARGE" });
    const chunks: Uint8Array[] = [];
    let total = 0;

    yield* request.stream.pipe(
      Stream.runForEach((chunk) => total + chunk.length > uploadLimit
        ? Effect.fail(new FileFailure({ code: "FILE_TOO_LARGE" }))
        : Effect.sync(() => { total += chunk.length; chunks.push(chunk); })),
      Effect.mapError((error) => error instanceof FileFailure ? error : new FileFailure({ code: "INVALID" })),
    );

    return json({ path: yield* run(() => uploadFile(paths.workspace, parsed.data.path, parsed.data.mode, Buffer.concat(chunks))) });
  });

  const edit = Effect.gen(function* () {
    const { request, token } = yield* session;
    yield* guarded(request, "application/json");
    const parsed = FileEdit.safeParse(yield* request.json.pipe(Effect.mapError(() => new FileFailure({ code: "INVALID" }))));

    if (!parsed.success) return yield* new FileFailure({ code: "INVALID" });
    yield* identity.authorize(token, parsed.data.csrf);
    yield* run(() => editWorkspace(paths.workspace, parsed.data));

    return json({ ok: true });
  });

  yield* router.add("GET", "/api/files", handled(list));
  yield* router.add("GET", "/api/files/paths", handled(everything));
  yield* router.add("GET", "/api/files/preview", handled(preview));
  yield* router.add("GET", "/api/files/download", handled(download));
  yield* router.add("POST", "/api/files/upload", handled(upload));
  yield* router.add("POST", "/api/files/edit", handled(edit));
}));
