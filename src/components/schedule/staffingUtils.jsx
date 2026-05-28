const STAFFING_PLAN_UNAVAILABLE_CODES = new Set(['KO', 'EZ', 'MS']);

export function getDoctorEffectiveFte(doctor, date, planEntries) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const entry = planEntries.find(e => e.doctor_id === doctor.id && e.year === year && e.month === month);

    const entryValue = typeof entry?.value === 'string' ? entry.value.trim() : entry?.value;
    let value;

    if (entryValue !== undefined && entryValue !== null && entryValue !== '') {
        value = String(entryValue);
    } else if (doctor.fte !== undefined && doctor.fte !== null && String(doctor.fte).trim() !== '') {
        value = String(doctor.fte);
    } else {
        value = '1.0';
    }

    const normalizedValue = String(value).trim();
    if (STAFFING_PLAN_UNAVAILABLE_CODES.has(normalizedValue)) {
        return 0;
    }

    const parsedFte = parseFloat(normalizedValue.replace(',', '.'));
    if (Number.isNaN(parsedFte)) {
        return 0;
    }

    return parsedFte;
}

export function isDoctorAvailable(doctor, date, planEntries) {
    // Check contract end
    if (doctor.contract_end_date) {
        const endDate = new Date(doctor.contract_end_date);
        endDate.setHours(0,0,0,0);
        const checkDate = new Date(date);
        checkDate.setHours(0,0,0,0);
        
        // If the date is strictly AFTER the end date, doctor is unavailable
        if (checkDate > endDate) return false;
    }
    
    return getDoctorEffectiveFte(doctor, date, planEntries) > 0.0001;
}

function blocksAvailability({ category, affectsAvailability, allowsRotationConcurrently }) {
    if (affectsAvailability === false) return false;
    if (allowsRotationConcurrently === true) return false;
    if (allowsRotationConcurrently === false) return true;
    if (['Dienste', 'Demonstrationen & Konsile'].includes(category)) return false;
    return true;
}

export function getAvailabilityBlockingDoctorIdsByDate({ localShifts = [], sharedShifts = [], workplaces = [], doctors = [] }) {
    const workplaceByName = new Map(workplaces.map((workplace) => [workplace.name, workplace]));
    const doctorIdsByCentralEmployeeId = new Map();

    doctors.forEach((doctor) => {
        if (!doctor?.central_employee_id) return;
        const key = String(doctor.central_employee_id);
        const existingDoctorIds = doctorIdsByCentralEmployeeId.get(key) || [];
        existingDoctorIds.push(doctor.id);
        doctorIdsByCentralEmployeeId.set(key, existingDoctorIds);
    });

    const blockingDoctorIdsByDate = new Map();

    const addDoctorId = (dateStr, doctorId) => {
        if (!dateStr || doctorId === undefined || doctorId === null) return;
        const existingDoctorIds = blockingDoctorIdsByDate.get(dateStr) || new Set();
        existingDoctorIds.add(doctorId);
        blockingDoctorIdsByDate.set(dateStr, existingDoctorIds);
    };

    localShifts.forEach((shift) => {
        const workplace = workplaceByName.get(shift?.position);
        if (!blocksAvailability({
            category: workplace?.category,
            affectsAvailability: workplace?.affects_availability,
            allowsRotationConcurrently: workplace?.allows_rotation_concurrently,
        })) {
            return;
        }

        addDoctorId(String(shift?.date).slice(0, 10), shift?.doctor_id);
    });

    sharedShifts.forEach((shift) => {
        if (!blocksAvailability({
            category: shift?.workplace_category,
            affectsAvailability: shift?.affects_availability,
            allowsRotationConcurrently: shift?.allows_rotation_concurrently,
        })) {
            return;
        }

        const mappedDoctorIds = doctorIdsByCentralEmployeeId.get(String(shift?.employee_id)) || [];
        mappedDoctorIds.forEach((doctorId) => addDoctorId(String(shift?.date).slice(0, 10), doctorId));
    });

    return blockingDoctorIdsByDate;
}

/**
 * Calculates the weekly target working hours for a doctor, adjusted for public holidays.
 * @param {number} fte - Full-time equivalent (e.g., 1.0, 0.75)
 * @param {Date} weekStart - Monday of the week
 * @param {string[]} holidays - Array of public holiday dates in 'YYYY-MM-DD' format that fall within the week
 * @param {number} [fullTimeWeeklyHours=40] - Full-time weekly hours for 1.0 FTE
 * @param {number} [workDaysPerWeek=5] - Number of working days per week (Mon-Fri)
 * @returns {number} Adjusted target weekly hours
 */
export function calculateWeeklyTargetHours(fte, weekStart, holidays = [], fullTimeWeeklyHours = 40, workDaysPerWeek = 5) {
  const baseWeeklyHours = fullTimeWeeklyHours * fte;
  const dailyHours = (fullTimeWeeklyHours / workDaysPerWeek) * fte;
  // Count holidays that fall on working days (Mon-Fri)
  const holidayCount = holidays.filter(holidayDate => {
    const holiday = new Date(holidayDate);
    const day = holiday.getDay();
    // Monday=1 ... Friday=5, Sunday=0
    return day >= 1 && day <= 5;
  }).length;
  return baseWeeklyHours - (holidayCount * dailyHours);
}