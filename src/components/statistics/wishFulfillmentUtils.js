import { getWishEndDate, getWishStartDate } from '@/utils/wishRange';

function groupByDoctorId(items) {
    const grouped = new Map();

    items.forEach((item) => {
        if (!item?.doctor_id) {
            return;
        }

        if (!grouped.has(item.doctor_id)) {
            grouped.set(item.doctor_id, []);
        }

        grouped.get(item.doctor_id).push(item);
    });

    return grouped;
}

function isServiceShift(shift) {
    return shift.position.includes('Dienst') || shift.position === 'Spätdienst';
}

export function buildWishFulfillmentStats({ doctors = [], wishes = [], shifts = [] }) {
    const wishesByDoctor = groupByDoctorId(wishes);
    const shiftsByDoctor = groupByDoctorId(shifts);

    return doctors
        .map((doctor) => {
            const doctorWishes = wishesByDoctor.get(doctor.id) || [];
            if (doctorWishes.length === 0) {
                return null;
            }

            const doctorShifts = shiftsByDoctor.get(doctor.id) || [];
            let fulfilled = 0;
            let approved = 0;
            let rejected = 0;

            doctorWishes.forEach((wish) => {
                if (wish.status === 'approved') approved += 1;
                if (wish.status === 'rejected') rejected += 1;

                const wishStartDate = getWishStartDate(wish);
                const wishEndDate = getWishEndDate(wish) || wishStartDate;
                const shiftsInRange = wishStartDate
                    ? doctorShifts.filter((shift) => shift.date >= wishStartDate && shift.date <= wishEndDate)
                    : [];

                const hasServiceShift = shiftsInRange.some(isServiceShift);
                const isFulfilled = wish.type === 'service' ? hasServiceShift : !hasServiceShift;

                if (isFulfilled) {
                    fulfilled += 1;
                }
            });

            const total = doctorWishes.length;

            return {
                name: doctor.name,
                role: doctor.role,
                total,
                fulfilled,
                rate: total > 0 ? Math.round((fulfilled / total) * 100) : 0,
                approved,
                rejected,
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.rate - a.rate);
}
