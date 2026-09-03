// eligibility-engine.js — pure, DOM-free eligibility decision engine
// Shared by: residents.js, eligibility.js, notifications.html

/** Classify total household income into B40 / M40 / T20 */
export function classifyIncome(income) {
    if (income <= 4850)  return 'B40';
    if (income <= 10970) return 'M40';
    return 'T20';
}

/** Sum household income: head of household + all family members */
export function getHouseholdIncome(resident) {
    let total = parseFloat(resident.income) || 0;
    (resident.familyMembers || []).forEach(m => { total += parseFloat(m.income) || 0; });
    return total;
}

/** Parse a Malaysian MyKad IC number into a Date of birth, or null if invalid */
function getDobFromIC(ic) {
    const digits = String(ic || '').replace(/[^0-9]/g, '');
    if (digits.length < 6) return null;
    const yy = parseInt(digits.substring(0, 2), 10);
    const mm = parseInt(digits.substring(2, 4), 10);
    const dd = parseInt(digits.substring(4, 6), 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const currentYear = new Date().getFullYear();
    const baseCentury = Math.floor(currentYear / 100) * 100;
    const fullYear = yy <= currentYear % 100 ? baseCentury + yy : baseCentury - 100 + yy;
    const dob = new Date(fullYear, mm - 1, dd);
    if (dob.getMonth() !== mm - 1 || dob.getDate() !== dd) return null;
    return dob;
}

/** Calculate completed years of age from a Date of birth */
function calculateAge(dob) {
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    return age;
}

/** Resolve age from IC (preferred) or stored fallback */
export function resolveAge(ic, fallbackAge) {
    const dob = getDobFromIC(ic);
    return dob ? calculateAge(dob) : (fallbackAge || 0);
}

/**
 * Full decision-tree eligibility evaluation.
 * Returns { status, priority, color, bg, reason }.
 */
export function evaluateEligibility(resident) {
    const householdIncome = getHouseholdIncome(resident);
    const category  = classifyIncome(householdIncome);
    const dependents = resident.dependents || 0;
    const perCapita  = dependents > 0 ? householdIncome / (dependents + 1) : householdIncome;
    const incomeStr  = `RM ${householdIncome.toLocaleString()}`;
    const pcStr      = `RM ${perCapita.toFixed(2)}`;

    let hasOku     = resident.oku === 'Ya';
    let hasElderly = resolveAge(resident.ic, resident.age) >= 60;
    (resident.familyMembers || []).forEach(m => {
        if (m.oku === 'Ya') hasOku = true;
        if (resolveAge(m.ic, m.age) >= 60) hasElderly = true;
    });

    const vulnerability = hasOku && hasElderly ? 'an OKU member and an elderly member'
        : hasOku    ? 'an OKU (disabled) member'
        : hasElderly ? 'an elderly member (age ≥ 60)'
        : null;

    if (category === 'B40') {
        if (perCapita <= 500 || dependents >= 5) {
            const trigger = perCapita <= 500
                ? `per capita income of ${pcStr} is below the RM 500 critical threshold`
                : `household has ${dependents} dependants, exceeding the threshold of 5`;
            return {
                status: 'Eligible', priority: 'Very High', color: '#ef4444', bg: '#fee2e2',
                reason: `Status: Very High Priority. Household income is ${incomeStr}, placing it in the B40 (low income) bracket. Critical need confirmed: ${trigger}. Qualifies for immediate welfare aid priority.`
            };
        }
        if (hasOku || hasElderly) {
            return {
                status: 'Eligible', priority: 'High', color: '#ea580c', bg: '#ffedd5',
                reason: `Status: High Priority. Household income is ${incomeStr} (B40 bracket) with per capita income of ${pcStr} and ${dependents} dependant(s). Vulnerability factor detected: ${vulnerability} is present in the household, elevating the priority classification.`
            };
        }
        return {
            status: 'Eligible', priority: 'Medium', color: '#d97706', bg: '#fef3c7',
            reason: `Status: Medium Priority. Household income is ${incomeStr} (B40 bracket) with per capita income of ${pcStr} and ${dependents} dependant(s). No additional vulnerability factors detected. Eligible for standard welfare aid consideration.`
        };
    }

    if (category === 'M40') {
        if (perCapita <= 800 && dependents >= 3) {
            if (hasOku || hasElderly) {
                return {
                    status: 'Eligible', priority: 'Medium', color: '#d97706', bg: '#fef3c7',
                    reason: `Status: Medium Priority. Household income is ${incomeStr} (M40 bracket). Economic strain detected: per capita income of ${pcStr} with ${dependents} dependant(s). Vulnerability factor detected: ${vulnerability} is present, elevating the priority.`
                };
            }
            return {
                status: 'Eligible', priority: 'Low', color: '#65a30d', bg: '#ecfccb',
                reason: `Status: Low Priority. Household income is ${incomeStr} (M40 bracket). Economic strain detected: per capita income of ${pcStr} with ${dependents} dependant(s). No additional vulnerability factors detected.`
            };
        }
        if (hasOku || hasElderly) {
            return {
                status: 'Eligible', priority: 'Low', color: '#65a30d', bg: '#ecfccb',
                reason: `Status: Low Priority. Household income is ${incomeStr} (M40 bracket) with per capita income of ${pcStr}. Vulnerability factor detected: ${vulnerability} is present in the household.`
            };
        }
        return {
            status: 'Not Eligible', priority: 'None', color: '#64748b', bg: '#f1f5f9',
            reason: `Status: Not Eligible. Household income is ${incomeStr} (M40 bracket) with per capita income of ${pcStr} and ${dependents} dependant(s). No eligibility conditions met under current welfare aid criteria.`
        };
    }

    // T20
    if (hasOku && hasElderly && dependents >= 5) {
        return {
            status: 'Eligible', priority: 'Low', color: '#65a30d', bg: '#ecfccb',
            reason: `Status: Low Priority. Household income is ${incomeStr} (T20 bracket). Although above the standard income threshold, eligibility is granted due to the combined presence of an OKU member, an elderly member, and ${dependents} dependants.`
        };
    }
    return {
        status: 'Not Eligible', priority: 'None', color: '#64748b', bg: '#f1f5f9',
        reason: `Status: Not Eligible. Household income is ${incomeStr} (T20 bracket) with per capita income of ${pcStr}. Income level is above the welfare aid eligibility threshold.`
    };
}
