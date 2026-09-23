import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { adminToken, createHarness, resetTaxonomy, type Harness } from './harness.js';

describe('subject and grade level taxonomy', () => {
  let h: Harness;
  let actor: string;
  let token: string;

  beforeAll(async () => {
    h = await createHarness();
    actor = h.operatorId;
    token = await adminToken(h.jwt, actor);
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetTaxonomy(h.prisma);
  });

  const audits = () => h.prisma.adminAudit.findMany({ orderBy: { createdAt: 'asc' } });

  it('creates a Subject enabled, with one matching audit row', async () => {
    const subject = await h.taxonomy.createSubject(actor, 'Mathematics');

    expect(subject.enabled).toBe(true);
    expect(subject.name).toBe('Mathematics');

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: actor,
      action: 'subject.create',
      targetType: 'Subject',
      targetId: subject.id,
    });
  });

  it('rejects a duplicate Subject name case-insensitively with 409', async () => {
    await h.taxonomy.createSubject(actor, 'Mathematics');
    await expect(h.taxonomy.createSubject(actor, 'mathematics')).rejects.toMatchObject({
      status: 409,
    });
    await request(h.app.getHttpServer())
      .post('/api/admin/taxonomy/subjects')
      .set('authorization', `Bearer ${token}`)
      .send({ name: '  MATHEMATICS ' })
      .expect(409);
  });

  it('renames a Subject in place, keeping its id, and audits before and after', async () => {
    const created = await h.taxonomy.createSubject(actor, 'Maths');
    const renamed = await h.taxonomy.renameSubject(actor, created.id, 'Mathematics');

    expect(renamed.id).toBe(created.id);
    expect(renamed.name).toBe('Mathematics');

    const rename = (await audits()).at(-1);
    expect(rename).toMatchObject({ action: 'subject.rename', targetId: created.id });
    expect(rename!.detail).toEqual({ from: 'Maths', to: 'Mathematics' });
  });

  it('404s renaming an unknown Subject and 409s renaming onto a taken name', async () => {
    const a = await h.taxonomy.createSubject(actor, 'Mathematics');
    await h.taxonomy.createSubject(actor, 'Science');

    await expect(
      h.taxonomy.renameSubject(actor, '00000000-0000-4000-8000-000000000000', 'Anything'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(h.taxonomy.renameSubject(actor, a.id, 'science')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('disables a Subject without deleting it, and drops it from selectable lists', async () => {
    const subject = await h.taxonomy.createSubject(actor, 'Mathematics');
    const grade = await h.taxonomy.createGradeLevel(actor, 'Grade 4');
    await h.taxonomy.setAvailability(actor, subject.id, grade.id, true);

    expect(await h.taxonomy.listSelectableSubjects(grade.id)).toHaveLength(1);

    const disabled = await h.taxonomy.setSubjectEnabled(actor, subject.id, false);
    expect(disabled.enabled).toBe(false);

    expect(await h.taxonomy.resolveSubject(subject.id)).toMatchObject({
      id: subject.id,
      name: 'Mathematics',
      enabled: false,
    });
    expect(await h.taxonomy.listSelectableSubjects(grade.id)).toEqual([]);
    expect((await audits()).at(-1)).toMatchObject({ action: 'subject.disable' });

    await expect(
      h.taxonomy.setSubjectEnabled(actor, '00000000-0000-4000-8000-000000000000', false),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('enables a mapping and the Subject appears for that Grade Level immediately', async () => {
    const subject = await h.taxonomy.createSubject(actor, 'Mathematics');
    const grade = await h.taxonomy.createGradeLevel(actor, 'Grade 4');

    expect(await h.taxonomy.listSelectableSubjects(grade.id)).toEqual([]);
    await h.taxonomy.setAvailability(actor, subject.id, grade.id, true);
    expect(await h.taxonomy.listSelectableSubjects(grade.id)).toEqual([
      { id: subject.id, name: 'Mathematics', enabled: true },
    ]);
    expect((await audits()).at(-1)).toMatchObject({
      action: 'availability.enable',
      targetType: 'SubjectGradeLevel',
    });

    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(h.taxonomy.setAvailability(actor, missing, grade.id, true)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      h.taxonomy.setAvailability(actor, subject.id, missing, true),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('disables the mapping only, leaving other Grade Levels untouched', async () => {
    const subject = await h.taxonomy.createSubject(actor, 'Mathematics');
    const four = await h.taxonomy.createGradeLevel(actor, 'Grade 4');
    const five = await h.taxonomy.createGradeLevel(actor, 'Grade 5');
    await h.taxonomy.setAvailability(actor, subject.id, four.id, true);
    await h.taxonomy.setAvailability(actor, subject.id, five.id, true);

    await h.taxonomy.setAvailability(actor, subject.id, four.id, false);

    expect(await h.taxonomy.listSelectableSubjects(four.id)).toEqual([]);
    expect(await h.taxonomy.listSelectableSubjects(five.id)).toHaveLength(1);
    expect(await h.taxonomy.resolveSubject(subject.id)).toMatchObject({ enabled: true });
  });

  it('404s disabling a mapping that does not exist', async () => {
    const subject = await h.taxonomy.createSubject(actor, 'Mathematics');
    const grade = await h.taxonomy.createGradeLevel(actor, 'Grade 4');
    await expect(
      h.taxonomy.setAvailability(actor, subject.id, grade.id, false),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns only fully-enabled combinations, ordered by Subject name', async () => {
    const grade = await h.taxonomy.createGradeLevel(actor, 'Grade 4');
    const science = await h.taxonomy.createSubject(actor, 'Science');
    const maths = await h.taxonomy.createSubject(actor, 'Mathematics');
    const english = await h.taxonomy.createSubject(actor, 'English');
    const history = await h.taxonomy.createSubject(actor, 'History');

    await h.taxonomy.setAvailability(actor, science.id, grade.id, true);
    await h.taxonomy.setAvailability(actor, maths.id, grade.id, true);
    await h.taxonomy.setAvailability(actor, english.id, grade.id, true);
    await h.taxonomy.setAvailability(actor, history.id, grade.id, true);

    // One of each flag turned off: subject disabled, mapping disabled.
    await h.taxonomy.setSubjectEnabled(actor, english.id, false);
    await h.taxonomy.setAvailability(actor, history.id, grade.id, false);

    expect((await h.taxonomy.listSelectableSubjects(grade.id)).map((s) => s.name)).toEqual([
      'Mathematics',
      'Science',
    ]);
  });

  it('returns an empty list for a disabled Grade Level', async () => {
    const subject = await h.taxonomy.createSubject(actor, 'Mathematics');
    const grade = await h.taxonomy.createGradeLevel(actor, 'Grade 4');
    await h.taxonomy.setAvailability(actor, subject.id, grade.id, true);

    await h.taxonomy.setGradeLevelEnabled(actor, grade.id, false);

    expect(await h.taxonomy.listSelectableSubjects(grade.id)).toEqual([]);
    expect(await h.taxonomy.resolveGradeLevel(grade.id)).toMatchObject({
      name: 'Grade 4',
      enabled: false,
    });
  });

  it('resolves an id captured before a rename and a disable', async () => {
    const subject = await h.taxonomy.createSubject(actor, 'Maths');
    const heldId = subject.id;

    await h.taxonomy.renameSubject(actor, heldId, 'Mathematics');
    await h.taxonomy.setSubjectEnabled(actor, heldId, false);

    expect(await h.taxonomy.resolveSubject(heldId)).toEqual({
      id: heldId,
      name: 'Mathematics',
      enabled: false,
    });

    const grade = await h.taxonomy.createGradeLevel(actor, 'Grade 4');
    await h.taxonomy.renameGradeLevel(actor, grade.id, 'Grade Four');
    await h.taxonomy.setGradeLevelEnabled(actor, grade.id, false);
    expect(await h.taxonomy.resolveGradeLevel(grade.id)).toEqual({
      id: grade.id,
      name: 'Grade Four',
      enabled: false,
    });
  });

  it('rolls the taxonomy write back when the audit write fails', async () => {
    vi.spyOn(h.audit, 'record').mockRejectedValue(new Error('audit unavailable'));

    await expect(h.taxonomy.createSubject(actor, 'Mathematics')).rejects.toThrow(
      'audit unavailable',
    );

    expect(await h.prisma.subject.count()).toBe(0);
    expect(await h.prisma.adminAudit.count()).toBe(0);
  });

  it('returns 409, never 500, when concurrent creates race on the unique index', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => h.taxonomy.createSubject(actor, 'Mathematics')),
    );

    const created = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const result of rejected) {
      expect(result.reason).toMatchObject({ status: 409 });
    }
    expect(await h.prisma.subject.count()).toBe(1);
  });

  it('returns 409, never 500, when concurrent renames race onto the same name', async () => {
    await h.taxonomy.createSubject(actor, 'Taken');
    const a = await h.taxonomy.createSubject(actor, 'A');
    const b = await h.taxonomy.createSubject(actor, 'B');

    const results = await Promise.allSettled([
      h.taxonomy.renameSubject(actor, a.id, 'Taken'),
      h.taxonomy.renameSubject(actor, b.id, 'Taken'),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409 });
    }
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(0);
  });

  it('treats names differing only by whitespace or Unicode form as the same item', async () => {
    const created = await h.taxonomy.createGradeLevel(actor, '  Grade   4 ');
    expect(created.name).toBe('Grade 4');

    await expect(h.taxonomy.createGradeLevel(actor, 'Grade 4')).rejects.toMatchObject({
      status: 409,
    });
    // NFKC folds the full-width digit onto the ASCII one.
    await expect(h.taxonomy.createGradeLevel(actor, 'Grade \uFF14')).rejects.toMatchObject({
      status: 409,
    });
    expect(await h.prisma.gradeLevel.count()).toBe(1);
  });

  it('rejects a whitespace-only name at the service boundary', async () => {
    await expect(h.taxonomy.createSubject(actor, '   ')).rejects.toMatchObject({ status: 400 });
    const subject = await h.taxonomy.createSubject(actor, 'Mathematics');
    await expect(h.taxonomy.renameSubject(actor, subject.id, ' \u00a0 ')).rejects.toMatchObject({
      status: 400,
    });
    expect(await h.prisma.subject.count()).toBe(1);
  });

  it('exposes the same behaviour over the REST surface', async () => {
    const server = h.app.getHttpServer();
    const auth = { authorization: `Bearer ${token}` };

    const subject = await request(server)
      .post('/api/admin/taxonomy/subjects')
      .set(auth)
      .send({ name: 'Mathematics' })
      .expect(201);
    const grade = await request(server)
      .post('/api/admin/taxonomy/grade-levels')
      .set(auth)
      .send({ name: 'Grade 4' })
      .expect(201);

    await request(server)
      .put('/api/admin/taxonomy/availability')
      .set(auth)
      .send({ subjectId: subject.body.id, gradeLevelId: grade.body.id, enabled: true })
      .expect(200);

    const selectable = await request(server)
      .get(`/api/admin/taxonomy/grade-levels/${grade.body.id}/selectable-subjects`)
      .set(auth)
      .expect(200);
    expect(selectable.body).toHaveLength(1);

    await request(server)
      .patch(`/api/admin/taxonomy/subjects/${subject.body.id}/name`)
      .set(auth)
      .send({ name: 'Maths' })
      .expect(200);

    const snapshot = await request(server).get('/api/admin/taxonomy').set(auth).expect(200);
    expect(snapshot.body.subjects[0]).toMatchObject({ id: subject.body.id, name: 'Maths' });
  });

  it('resolves a Subject and a Grade Level by id over the REST surface, even when disabled', async () => {
    const server = h.app.getHttpServer();
    const auth = { authorization: `Bearer ${token}` };

    const subject = await request(server)
      .post('/api/admin/taxonomy/subjects')
      .set(auth)
      .send({ name: 'Science' })
      .expect(201);
    const grade = await request(server)
      .post('/api/admin/taxonomy/grade-levels')
      .set(auth)
      .send({ name: 'Grade 5' })
      .expect(201);

    await request(server)
      .patch(`/api/admin/taxonomy/subjects/${subject.body.id}/enabled`)
      .set(auth)
      .send({ enabled: false })
      .expect(200);

    const resolvedSubject = await request(server)
      .get(`/api/admin/taxonomy/subjects/${subject.body.id}`)
      .set(auth)
      .expect(200);
    expect(resolvedSubject.body).toMatchObject({
      id: subject.body.id,
      name: 'Science',
      enabled: false,
    });

    const resolvedGrade = await request(server)
      .get(`/api/admin/taxonomy/grade-levels/${grade.body.id}`)
      .set(auth)
      .expect(200);
    expect(resolvedGrade.body).toMatchObject({ id: grade.body.id, name: 'Grade 5' });

    await request(server)
      .get(`/api/admin/taxonomy/subjects/${crypto.randomUUID()}`)
      .set(auth)
      .expect(404);
    await request(server)
      .get(`/api/admin/taxonomy/grade-levels/${crypto.randomUUID()}`)
      .set(auth)
      .expect(404);
  });
});
