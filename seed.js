const API = 'https://tsp-task-manager-production.up.railway.app/api';

const projects = [
  'Houston First', 'Broadway Ops', 'Still Got It', 'ADX Academy', 'ADX Live',
  'Websites', 'Original Shows', 'Broadway Prospects', 'TSP for Hire', 'Personal'
];

const projectMap = {
  'houston-first':      'Houston First',
  'broadway-ops':       'Broadway Ops',
  'still-got-it':       'Still Got It',
  'adx-academy':        'ADX Academy',
  'adx-live':           'ADX Live',
  'websites':           'Websites',
  'original-shows':     'Original Shows',
  'broadway-prospects': 'Broadway Prospects',
  'tsp-for-hire':       'TSP for Hire',
  'personal':           'Personal',
};

const tasks = [
  { priority: 'urgent', category: 'ops',        project: 'houston-first',      title: 'Houston First - Finalize budget',                     due: '2026-08-07', estimatedTime: 2,   status: 'in-progress', notes: 'Production starts soon; blocks casting link' },
  { priority: 'urgent', category: 'ops',        project: 'houston-first',      title: 'Houston First - Casting link',                        due: '2026-08-07', estimatedTime: 1.5, status: 'pending',     notes: 'Needed for compensation agreement' },
  { priority: 'urgent', category: 'accounting', project: 'houston-first',      title: 'Houston First - Compensation agreement',               due: '2026-08-07', estimatedTime: 1,   status: 'pending',     notes: 'Legal review; affects casting' },
  { priority: 'urgent', category: 'sales',      project: 'tsp-for-hire',       title: 'TSP Producer for Hire - Kesha reconnect',             due: '2026-08-07', estimatedTime: 0.5, status: 'pending',     notes: 'New lead; revenue opportunity' },
  { priority: 'high',   category: 'ops',        project: 'broadway-ops',       title: 'Broadway operations - Update accounts (Accounting)',   due: '2026-08-08', estimatedTime: 1.5, status: 'pending',     notes: 'Finance sync required' },
  { priority: 'high',   category: 'ops',        project: 'broadway-ops',       title: 'Broadway operations - Communication & operations',     due: '2026-08-08', estimatedTime: 2,   status: 'pending',     notes: 'Vendor/partner updates' },
  { priority: 'high',   category: 'accounting', project: 'still-got-it',       title: 'Still Got It - Updated budget',                       due: '2026-08-09', estimatedTime: 2,   status: 'pending',     notes: 'Sponsorship/production tracking' },
  { priority: 'high',   category: 'ops',        project: 'houston-first',      title: 'Houston First - Company email setup',                  due: '2026-08-09', estimatedTime: 0.5, status: 'pending',     notes: 'Admin/vendor coordination' },
  { priority: 'high',   category: 'ops',        project: 'houston-first',      title: 'Houston First - Chika pricing on charts',              due: '2026-08-09', estimatedTime: 1,   status: 'pending',     notes: 'Production design/logistics' },
  { priority: 'high',   category: 'ops',        project: 'adx-academy',        title: 'ADX Academy - Broadway program',                      due: '2026-08-09', estimatedTime: 2.5, status: 'pending',     notes: 'Revenue focus; enrollments pending' },
  { priority: 'high',   category: 'sales',      project: 'broadway-prospects', title: 'Send Stacy proposal',                                 due: '2026-08-08', estimatedTime: 1.5, status: 'pending',     notes: 'Broadway prospects' },
  { priority: 'medium', category: 'admin',      project: 'adx-live',           title: 'City of Houston parade commitment decision',           due: '2026-08-10', estimatedTime: 1,   status: 'pending',     notes: 'Cancel / PWP / Fayla Curry options' },
  { priority: 'medium', category: 'marketing',  project: 'websites',           title: 'ADX Website - TSP site build',                        due: '2026-08-15', estimatedTime: 3,   status: 'pending',     notes: 'Creative leadership + event mgmt sections' },
  { priority: 'medium', category: 'marketing',  project: 'websites',           title: 'ADX Website - ADX Academy site',                      due: '2026-08-15', estimatedTime: 2.5, status: 'pending',     notes: 'Program pages + enrollment flow' },
  { priority: 'medium', category: 'ops',        project: 'adx-academy',        title: 'ADX Academy - XLR8 programs',                         due: '2026-08-15', estimatedTime: 2,   status: 'pending',     notes: 'Content + schedule updates' },
  { priority: 'medium', category: 'ops',        project: 'adx-academy',        title: 'ADX Academy - Orlando dance/music programs',           due: '2026-08-15', estimatedTime: 2,   status: 'pending',     notes: 'Partner coordination' },
  { priority: 'medium', category: 'ops',        project: 'adx-academy',        title: 'CYT Orlando show dates confirmation',                  due: '2026-08-12', estimatedTime: 1,   status: 'pending',     notes: 'Winter/spring schedule; add to calendar' },
  { priority: 'medium', category: 'pm',         project: 'adx-live',           title: 'FWBG - Name the show "Pop Chocolate Holiday"',         due: '2026-08-10', estimatedTime: 0.5, status: 'pending',     notes: 'Branding decision' },
  { priority: 'medium', category: 'pm',         project: 'adx-live',           title: 'FWBG - 2027 show idea development',                   due: '2026-08-15', estimatedTime: 2,   status: 'pending',     notes: 'Strategic planning' },
  { priority: 'medium', category: 'ops',        project: 'adx-live',           title: 'Univ of Houston - Touch base',                        due: '2026-08-15', estimatedTime: 0.5, status: 'pending',     notes: 'Relationship maintenance' },
  { priority: 'low',    category: 'personal',   project: 'personal',           title: 'Personal - Home Depot (nuts for bed, putty for wall)', due: '2026-08-20', estimatedTime: 1,   status: 'pending',     notes: 'Personal errands' },
  { priority: 'low',    category: 'pm',         project: 'personal',           title: 'Panama trip - Book by September 1st',                  due: '2026-09-01', estimatedTime: 1,   status: 'pending',     notes: 'January travel; add to calendar' },
  { priority: 'low',    category: 'pm',         project: 'still-got-it',       title: 'Still Got It - Encore Getaways sponsorship',           due: '2026-08-20', estimatedTime: 1.5, status: 'pending',     notes: 'Revenue opportunity' },
  { priority: 'low',    category: 'pm',         project: 'still-got-it',       title: 'Still Got It - Set design planning',                   due: '2026-08-25', estimatedTime: 3,   status: 'pending',     notes: 'Production bible included' },
  { priority: 'low',    category: 'pm',         project: 'still-got-it',       title: 'Still Got It - Production timeline',                   due: '2026-08-25', estimatedTime: 2,   status: 'pending',     notes: 'Critical path + milestones' },
  { priority: 'low',    category: 'pm',         project: 'original-shows',     title: 'Original shows - TBS development',                    due: '2026-08-30', estimatedTime: 2.5, status: 'pending',     notes: 'IP pipeline' },
  { priority: 'low',    category: 'pm',         project: 'original-shows',     title: 'Original shows - Skulduggery (Teen/Youth)',            due: '2026-09-05', estimatedTime: 2,   status: 'pending',     notes: 'IP pipeline' },
  { priority: 'low',    category: 'pm',         project: 'original-shows',     title: 'Original shows - Panama Diggers show',                 due: '2026-09-10', estimatedTime: 2.5, status: 'pending',     notes: 'International production' },
  { priority: 'low',    category: 'sales',      project: 'broadway-prospects', title: 'Broadway prospects - Pageant Mom & Family',            due: '2026-08-25', estimatedTime: 1,   status: 'pending',     notes: 'Production pipeline' },
  { priority: 'low',    category: 'sales',      project: 'broadway-prospects', title: 'Broadway prospects - Choir Boy',                      due: '2026-08-25', estimatedTime: 1,   status: 'pending',     notes: 'Production pipeline' },
  { priority: 'low',    category: 'sales',      project: 'broadway-prospects', title: 'Broadway prospects - Philip Hall',                    due: '2026-08-25', estimatedTime: 1,   status: 'pending',     notes: 'Production pipeline' },
  { priority: 'low',    category: 'sales',      project: 'broadway-prospects', title: 'Broadway prospects - Dance Dynamics',                 due: '2026-08-25', estimatedTime: 1,   status: 'pending',     notes: 'Production pipeline' },
  { priority: 'low',    category: 'pm',         project: 'adx-live',           title: 'FWBG - Comicpalooza + Fable Fest opportunity',         due: '2026-09-15', estimatedTime: 1.5, status: 'pending',     notes: 'Event partnerships' },
  { priority: 'low',    category: 'pm',         project: 'adx-live',           title: 'TSP - Conventions (Fable Fest, Soccer Fest)',          due: '2026-09-20', estimatedTime: 2,   status: 'pending',     notes: 'Event/vendor opportunities' },
];

async function seed() {
  console.log('Seeding projects…');
  for (const name of projects) {
    const res = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    console.log(res.ok ? `  ✓ ${name}` : `  ✗ ${name} (${res.status})`);
  }

  console.log('\nSeeding tasks…');
  for (const t of tasks) {
    const res = await fetch(`${API}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:             t.title,
        priority:          t.priority,
        category:          t.category,
        project:           projectMap[t.project],
        status:            t.status,
        due_date:          t.due,
        estimated_minutes: Math.round(t.estimatedTime * 60),
        notes:             t.notes,
      })
    });
    console.log(res.ok ? `  ✓ ${t.title}` : `  ✗ ${t.title} (${res.status})`);
  }

  console.log('\nDone. 10 projects + 34 tasks seeded.');
}

seed();
