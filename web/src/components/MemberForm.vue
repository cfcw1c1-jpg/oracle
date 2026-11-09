<script setup>
import { memberRoleLabel, ROLE_OPTION_CODES, STATUS_OPTIONS } from '@/lib/members';

defineProps({
  form: { type: Object, required: true },
  idLocked: Boolean,
  areas: { type: Array, default: () => [] },
  households: { type: Array, default: () => [] },
});

function toggleGender(form, gender) {
  form.Gender = form.Gender === gender ? '' : gender;
}
</script>

<template>
  <div class="form-grid">
    <label class="field"><span class="field-label">Member ID{{ idLocked ? '' : ' *' }}</span><input v-model="form.MemberIDNo" class="input" :disabled="idLocked" autocapitalize="none" /></label>
    <label class="field"><span class="field-label">Last Name *</span><input v-model="form.Lastname" class="input" placeholder="Dela Cruz" /></label>
    <label class="field"><span class="field-label">First Name *</span><input v-model="form.Firstname" class="input" placeholder="Juan" /></label>
    <div class="field">
      <span class="field-label">Gender</span>
      <div class="tabs"><button v-for="gender in ['Male', 'Female']" :key="gender" type="button" class="tab" :class="{ active: form.Gender === gender }" @click="toggleGender(form, gender)">{{ gender }}</button></div>
    </div>
    <label class="field"><span class="field-label">Status</span><select v-model="form.Status" class="select"><option v-for="status in STATUS_OPTIONS" :key="status">{{ status }}</option></select></label>
    <label class="field"><span class="field-label">Pastoral Service</span>
      <select v-model="form.PastoralService" class="select">
        <option value="">Select role…</option>
        <option v-if="form.PastoralService && !ROLE_OPTION_CODES.includes(form.PastoralService)" :value="form.PastoralService">{{ memberRoleLabel(form.PastoralService) }}</option>
        <option v-for="code in ROLE_OPTION_CODES" :key="code" :value="code">{{ memberRoleLabel(code) }}</option>
      </select>
    </label>
    <label class="field"><span class="field-label">Area</span><input v-model="form.AreaName" class="input" list="member-areas" placeholder="e.g. West 1C2" /></label>
    <datalist id="member-areas"><option v-for="area in areas" :key="area" :value="area" /></datalist>
    <label class="field"><span class="field-label">Household Head</span><input v-model="form.NameOfHouseholdHead" class="input" list="member-households" placeholder="Name of household head" /></label>
    <datalist id="member-households"><option v-for="name in households" :key="name" :value="name" /></datalist>
    <label class="field"><span class="field-label">Year Registered</span><input v-model="form.YearRegistered" class="input" inputmode="numeric" maxlength="4" placeholder="e.g. 2024" /></label>
    <label class="field"><span class="field-label">Spouse</span><input v-model="form.SpouseName" class="input" placeholder="Dela Cruz, Maria" /></label>
    <label class="field"><span class="field-label">Email</span><input v-model="form.Email" class="input" type="email" placeholder="name@example.com" autocapitalize="none" /></label>
    <label class="field"><span class="field-label">Mobile #</span><input v-model="form.MobileNo" class="input" inputmode="tel" placeholder="09XXXXXXXXX" /></label>
    <label class="field"><span class="field-label">Phone</span><input v-model="form.Phone" class="input" inputmode="tel" placeholder="Landline" /></label>
  </div>
</template>
