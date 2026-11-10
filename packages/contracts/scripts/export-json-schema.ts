/** Export contract schemas as JSON Schema 2020-12. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  AssignmentSchema,
  CancelAssignmentSchema,
  CreateAssignmentSchema,
  DestroyWorkdirResponseSchema,
  DestroyWorkdirSchema,
  ExecutorErrorSchema,
  GetAssignmentSchema,
  ListFilesResponseSchema,
  ListFilesSchema,
  ListPreviewsResponseSchema,
  ListPreviewsSchema,
  ReadFileResponseSchema,
  ReadFileSchema,
  StopPreviewsResponseSchema,
  StopPreviewsSchema,
  StreamEventsResponseSchema,
  StreamEventsSchema,
  TouchWorkdirResponseSchema,
  TouchWorkdirSchema,
  UploadLocalArtifactsResponseSchema,
  UploadLocalArtifactsSchema,
} from '../src/executor.ts'
import { AnalyticsEventSchema } from '../src/analytics.ts'

const here = dirname(fileURLToPath(import.meta.url))
const output = join(here, '..', 'schema')
const schemas = {
  CreateAssignment: CreateAssignmentSchema,
  Assignment: AssignmentSchema,
  GetAssignment: GetAssignmentSchema,
  CancelAssignment: CancelAssignmentSchema,
  StreamEvents: StreamEventsSchema,
  StreamEventsResponse: StreamEventsResponseSchema,
  ListPreviews: ListPreviewsSchema,
  ListPreviewsResponse: ListPreviewsResponseSchema,
  StopPreviews: StopPreviewsSchema,
  StopPreviewsResponse: StopPreviewsResponseSchema,
  DestroyWorkdir: DestroyWorkdirSchema,
  DestroyWorkdirResponse: DestroyWorkdirResponseSchema,
  TouchWorkdir: TouchWorkdirSchema,
  TouchWorkdirResponse: TouchWorkdirResponseSchema,
  ListFiles: ListFilesSchema,
  ListFilesResponse: ListFilesResponseSchema,
  ReadFile: ReadFileSchema,
  ReadFileResponse: ReadFileResponseSchema,
  UploadLocalArtifacts: UploadLocalArtifactsSchema,
  UploadLocalArtifactsResponse: UploadLocalArtifactsResponseSchema,
  ExecutorError: ExecutorErrorSchema,
  AnalyticsEvent: AnalyticsEventSchema,
} as const

await mkdir(output, { recursive: true })
const index: Record<string, string> = {}
for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' })
  const file = `${name}.schema.json`
  await writeFile(join(output, file), `${JSON.stringify(json, undefined, 2)}\n`)
  index[name] = file
}
await writeFile(join(output, 'index.json'), `${JSON.stringify(index, undefined, 2)}\n`)
console.log(JSON.stringify({ exported: Object.keys(schemas).length, output }, null, 2))
