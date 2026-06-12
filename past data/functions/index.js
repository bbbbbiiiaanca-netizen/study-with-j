const admin = require('firebase-admin');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');

admin.initializeApp();
const db = admin.firestore();

async function getTokensForRole(role, studentId = '') {
  let q = db.collection('notification_tokens').where('role', '==', role).where('active', '==', true);
  if ((role === 'parent' || role === 'student') && studentId) q = q.where('studentId', '==', studentId);
  const snap = await q.get();
  return snap.docs.map(d => ({ id: d.id, token: d.data().token })).filter(x => x.token);
}

async function getTokensForRoles(roles = []) {
  const rolesUniq = [...new Set(roles.filter(Boolean))];
  const all = await Promise.all(rolesUniq.map(role => getTokensForRole(role)));
  const dedup = new Map();
  all.flat().forEach(x => { if (!dedup.has(x.token)) dedup.set(x.token, x); });
  return [...dedup.values()];
}

async function sendToTargets(targets, title, body, data = {}) {
  if (!targets.length) return;
  const tokens = targets.map(x => x.token);
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title },
    webpush: {
      notification: { title, icon: '/icon-192.png', badge: '/icon-192.png' },
      fcmOptions: { link: '/' }
    },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? '')]))
  });

  const batch = db.batch();
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        batch.set(
          db.collection('notification_tokens').doc(targets[i].id),
          { active: false, disabledAt: admin.firestore.FieldValue.serverTimestamp(), errorCode: code },
          { merge: true }
        );
      }
    }
  });
  await batch.commit();
}

exports.onHomeworkCreated = onDocumentCreated('homework/{id}', async (event) => {
  const v = event.data && event.data.data();
  if (!v || !v.studentId) return;
  const targets = await getTokensForRole('parent', v.studentId);
  await sendToTargets(
    targets,
    '숙제가 등록되었습니다',
    `${v.studentName || '학생'} · ${v.subject || '과목 없음'}\n${v.task || ''}`,
    { type: 'homework', studentId: v.studentId, id: event.params.id }
  );
});

exports.onLessonCreated = onDocumentCreated('lessons/{id}', async (event) => {
  const v = event.data && event.data.data();
  if (!v || !v.studentId) return;
  const targets = await getTokensForRole('parent', v.studentId);
  await sendToTargets(
    targets,
    '수업일지가 등록되었습니다',
    `${v.studentName || '학생'} · ${v.subject || '과목 없음'}\n${v.comment || v.progress || ''}`,
    { type: 'lesson', studentId: v.studentId, id: event.params.id }
  );
});

exports.onBiweeklyReportCreated = onDocumentCreated('biweekly_reports/{id}', async (event) => {
  const v = event.data && event.data.data();
  if (!v || !v.studentId) return;
  const targets = await getTokensForRole('parent', v.studentId);
  await sendToTargets(
    targets,
    '2주 리포트가 등록되었습니다',
    `${v.studentName || '학생'} 리포트가 올라왔습니다.`,
    { type: 'biweekly_report', studentId: v.studentId, id: event.params.id }
  );
});

exports.onAnnouncementCreated = onDocumentCreated('announcements/{id}', async (event) => {
  const v = event.data && event.data.data();
  if (!v) return;
  const targets = await getTokensForRoles(['parent', 'student']);
  await sendToTargets(
    targets,
    v.title || '공지사항이 등록되었습니다',
    v.content || '',
    { type: 'announcement', id: event.params.id }
  );
});

exports.onFeedbackCreated = onDocumentCreated('feedbacks/{id}', async (event) => {
  const v = event.data && event.data.data();
  if (!v) return;
  if (v.senderRole === 'parent' || v.senderRole === 'student') {
    const targets = await getTokensForRole('admin');
    await sendToTargets(
      targets,
      '건의사항이 등록되었습니다',
      `${v.studentName || ''} ${v.senderRole === 'parent' ? '학부모' : '학생'}\n${v.content || ''}`,
      { type: 'feedback', id: event.params.id, studentId: v.studentId || '', thread: v.thread || '' }
    );
  }
});

exports.onFeedbackReplyUpdated = onDocumentUpdated('feedbacks/{id}', async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  if (!after.studentId || !after.adminReply || before.adminReply === after.adminReply) return;

  const targetRole = after.thread === 'student' ? 'student' : 'parent';
  const targets = await getTokensForRole(targetRole, after.studentId);
  await sendToTargets(
    targets,
    '건의사항 답변이 등록되었습니다',
    after.adminReply || '답변이 등록되었습니다.',
    { type: 'feedback_reply', id: event.params.id, studentId: after.studentId, thread: after.thread || '' }
  );
});

exports.onLessonParentReplyUpdated = onDocumentUpdated('lessons/{id}', async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  if (!after.parentReply || before.parentReply === after.parentReply) return;
  const targets = await getTokensForRole('admin');
  await sendToTargets(
    targets,
    '수업일지 답글이 등록되었습니다',
    `${after.studentName || ''} 학부모\n${after.parentReply || ''}`,
    { type: 'lesson_reply', id: event.params.id, studentId: after.studentId || '' }
  );
});

exports.onPushTestCreated = onDocumentCreated('push_tests/{id}', async (event) => {
  const v = event.data && event.data.data();
  if (!v) return;
  const targetRole = v.targetRole || 'admin';
  const targetStudentId = v.targetStudentId || '';
  const targets = await getTokensForRole(targetRole, targetStudentId);
  await sendToTargets(
    targets,
    v.title || '한일공부방 테스트 알림',
    '',
    { type: 'push_test', id: event.params.id, targetRole, targetStudentId }
  );
});
