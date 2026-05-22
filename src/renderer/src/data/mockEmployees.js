const FIRST_NAMES = [
  'Alexander', 'Sophia', 'Michael', 'Emma', 'James', 'Olivia', 'William', 'Ava',
  'Benjamin', 'Isabella', 'Lucas', 'Mia', 'Henry', 'Charlotte', 'Sebastian',
  'Amelia', 'Jack', 'Harper', 'Owen', 'Evelyn', 'Ethan', 'Abigail', 'Noah',
  'Emily', 'Liam', 'Elizabeth', 'Mason', 'Sofia', 'Logan', 'Avery', 'Elijah',
  'Ella', 'Oliver', 'Scarlett', 'Jacob', 'Grace', 'Aiden', 'Victoria', 'Jayden',
  'Riley', 'Muhammad', 'Aria', 'Daniel', 'Lily', 'David', 'Aurora', 'Joseph',
  'Chloe', 'Samuel', 'Penelope',
]

const LAST_NAMES = [
  'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson',
  'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin',
  'Thompson', 'Moore', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres',
  'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall',
  'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips',
  'Evans', 'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes',
  'Stewart', 'Morris', 'Morales', 'Murphy',
]

const DEPARTMENTS = [
  'Engineering', 'Product', 'Design', 'Marketing', 'Sales',
  'Finance', 'HR', 'Operations', 'Legal', 'Customer Success',
]

const POSITIONS = {
  Engineering: ['Senior Engineer', 'Junior Engineer', 'Tech Lead', 'Architect', 'DevOps'],
  Product: ['Product Manager', 'Product Owner', 'Business Analyst', 'Scrum Master'],
  Design: ['UI Designer', 'UX Designer', 'Visual Designer', 'Design Lead'],
  Marketing: ['Marketing Manager', 'Content Strategist', 'SEO Specialist', 'Brand Manager'],
  Sales: ['Account Executive', 'Sales Rep', 'Sales Manager', 'Business Dev'],
  Finance: ['Financial Analyst', 'Accountant', 'CFO Assistant', 'Controller'],
  HR: ['HR Manager', 'Recruiter', 'HR Generalist', 'Talent Acquisition'],
  Operations: ['Operations Manager', 'Logistics Coordinator', 'Analyst', 'Specialist'],
  Legal: ['Legal Counsel', 'Paralegal', 'Compliance Officer', 'Contract Specialist'],
  'Customer Success': ['CS Manager', 'Support Specialist', 'Account Manager', 'Onboarding Lead'],
}

function seededRandom(seed) {
  let s = seed
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

export function generateMockEmployees(count = 300) {
  const employees = []
  for (let i = 0; i < count; i++) {
    const rand = seededRandom(i * 7919 + 31337)
    const firstName = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)]
    const lastName = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]
    const department = DEPARTMENTS[Math.floor(rand() * DEPARTMENTS.length)]
    const positions = POSITIONS[department]
    const position = positions[Math.floor(rand() * positions.length)]
    const hoursWorked = Math.round((120 + rand() * 60) * 10) / 10
    const hourlyRate = Math.round((15 + rand() * 85) * 100) / 100

    employees.push({
      id: `EMP-${String(i + 1).padStart(4, '0')}`,
      name: `${firstName} ${lastName}`,
      department,
      position,
      hoursWorked,
      hourlyRate,
      bonuses: 0,
      fines: 0,
      avatar: `${firstName[0]}${lastName[0]}`,
    })
  }
  return employees
}
