import { randomUUID } from 'crypto'
import { db } from './client.js'

export function ensureProjectExists(projectId: string): string {
  if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
    return ''
  }

  // 1. Resolve slug if project id is proj-*
  let cleanId = projectId.trim()
  if (cleanId.startsWith('proj-')) {
    const proj = db.prepare('SELECT slug FROM projects WHERE id = ?').get(cleanId) as { slug: string } | undefined
    if (proj?.slug) {
      cleanId = proj.slug
    }
  }
  cleanId = cleanId.toLowerCase()

  // 2. See if this slug already exists
  const existingProj = db.prepare('SELECT id, slug FROM projects WHERE slug = ? OR id = ?').get(cleanId, cleanId) as { id: string; slug: string } | undefined
  if (existingProj) {
    return existingProj.slug
  }

  // 3. Project doesn't exist. Ensure "Personal" organization exists.
  const orgSlug = 'personal'
  let defaultOrg = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(orgSlug) as { id: string } | undefined

  if (!defaultOrg) {
    const orgId = `org-${randomUUID().slice(0, 8)}`
    try {
      db.prepare(
        'INSERT INTO organizations (id, name, slug, description) VALUES (?, ?, ?, ?)'
      ).run(orgId, 'Personal', orgSlug, 'Default personal organization')
      defaultOrg = { id: orgId }
    } catch {
      // In case of race condition
      defaultOrg = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(orgSlug) as { id: string }
    }
  }

  if (!defaultOrg) return cleanId

  // 4. Create the project
  const newProjId = `proj-${randomUUID().slice(0, 8)}`
  try {
    // We use the passed string as name initially, human readable
    const readableName = cleanId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    db.prepare(
      `INSERT INTO projects (id, org_id, name, slug)
       VALUES (?, ?, ?, ?)`
    ).run(newProjId, defaultOrg.id, readableName, cleanId)
  } catch (err) {
    // Ignore if parallel requests try to insert same slug
  }

  return cleanId
}
