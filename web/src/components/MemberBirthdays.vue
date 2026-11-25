<script setup>
import { Download, Image } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import SearchInput from '@/components/SearchInput.vue';
import { buildAreaOptions, loadAssignedAreaNames, matchesArea } from '@/lib/areas';
import { renderBirthdayImages } from '@/lib/birthdayImage';
import { downloadBlob, exportCsv, fetchAllRows } from '@/lib/data';
import { memberRoleLabel, STATUS_OPTIONS } from '@/lib/members';

// Birthday celebrants worked out from Oracle's own members ("Birthday"), so no
// OGD sign-in is needed. Row-level security already limits members to the
// account's chapters.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SELECT_COLUMNS = 'MemberIDNo, Lastname, Firstname, PastoralService, AreaName, NameOfHouseholdHead, Status, MobileNo, Phone, Email, Birthday';

const members = ref([]);
const assignedAreaNames = ref([]);
const loadState = reactive({ status: 'loading', message: '' });
const search = ref('');
const filters = ref({ area: 'All', status: 'Active' });
let isActive = true;

function manilaYear() {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric' }).format(new Date()));
}
const year = manilaYear();
const currentMonth = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'numeric' }).format(new Date()));
// Several months can be chosen; at least one always stays on.
const selectedMonths = ref([currentMonth]);
const sortedMonths = computed(() => [...selectedMonths.value].sort((a, b) => a - b));
const monthNames = computed(() => {
  const names = sortedMonths.value.map((value) => MONTHS[value - 1]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names.at(-1)}` : names[0];
});
const monthSlug = computed(() => sortedMonths.value.map((value) => MONTHS[value - 1].slice(0, 3).toLowerCase()).join('-'));

function toggleMonth(value) {
  const isOn = selectedMonths.value.includes(value);
  if (isOn && selectedMonths.value.length === 1) return;
  selectedMonths.value = isOn ? selectedMonths.value.filter((entry) => entry !== value) : [...selectedMonths.value, value];
}

const statusOf = (member) => member.Status || 'Active';

function parseBirthday(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

const areaOptions = computed(() => buildAreaOptions(assignedAreaNames.value, members.value.map((member) => member.AreaName)));
const missingBirthdayCount = computed(() => members.value.filter((member) => !member.birthday).length);

const celebrants = computed(() => {
  const { area, status } = filters.value;
  return members.value.filter((member) => selectedMonths.value.includes(member.birthday?.month)
    && matchesArea(area, member.AreaName)
    && (status === 'All' || statusOf(member) === status));
});

const visibleCelebrants = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return celebrants.value;
  return celebrants.value.filter((member) => [member.Firstname, member.Lastname, member.MemberIDNo, member.AreaName, member.NameOfHouseholdHead]
    .filter(Boolean).join(' ').toLowerCase().includes(query));
});

const birthdayLabel = (member) => new Date(2000, member.birthday.month - 1, member.birthday.day).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
const birthdayOrder = (member) => member.birthday.month * 100 + member.birthday.day;
const byBirthday = (a, b) => birthdayOrder(a) - birthdayOrder(b) || `${a.Lastname} ${a.Firstname}`.localeCompare(`${b.Lastname} ${b.Firstname}`);
const turningAge = (member) => (member.birthday.year > 1900 && member.birthday.year < year ? year - member.birthday.year : null);

const columns = [
  { key: 'day', label: 'Birthday', value: birthdayOrder },
  { key: 'name', label: 'Name', value: (member) => `${member.Lastname}, ${member.Firstname}` },
  { key: 'age', label: `Turning (${year})`, value: turningAge },
  { key: 'role', label: 'Role', value: (member) => memberRoleLabel(member.PastoralService) },
  { key: 'AreaName', label: 'Area' },
  { key: 'NameOfHouseholdHead', label: 'Household Head' },
  { key: 'contact', label: 'Contact', value: (member) => member.MobileNo || member.Phone || member.Email || '' },
  { key: 'status', label: 'Status', value: statusOf },
];

const EXPORT_COLUMNS = [
  { key: 'birthday', label: 'Birthday', value: birthdayLabel },
  { key: 'Birthdate', label: 'Birthdate', value: (member) => member.Birthday },
  { key: 'age', label: `Turning (${year})`, value: (member) => turningAge(member) ?? '' },
  { key: 'MemberIDNo', label: 'Member ID' },
  { key: 'Lastname', label: 'Last Name' },
  { key: 'Firstname', label: 'First Name' },
  { key: 'role', label: 'Role', value: (member) => memberRoleLabel(member.PastoralService) },
  { key: 'AreaName', label: 'Area' },
  { key: 'NameOfHouseholdHead', label: 'Household Head' },
  { key: 'MobileNo', label: 'Mobile' },
  { key: 'Phone', label: 'Phone' },
  { key: 'Email', label: 'Email' },
  { key: 'status', label: 'Status', value: statusOf },
];

function handleExport() {
  if (!visibleCelebrants.value.length) return;
  exportCsv(`member-birthdays-${monthSlug.value}`, EXPORT_COLUMNS, [...visibleCelebrants.value].sort(byBirthday));
}

// Greeting images of the celebrants on screen (filters and search applied),
// with only the date, name and role.
const imageState = reactive({ isOpen: false, status: 'idle', message: '', images: [] });

async function openImages() {
  if (!visibleCelebrants.value.length) return;
  Object.assign(imageState, { isOpen: true, status: 'loading', message: '', images: [] });
  try {
    const rows = [...visibleCelebrants.value].sort(byBirthday).map((member) => ({
      month: member.birthday.month,
      day: member.birthday.day,
      name: [member.Firstname, member.Lastname].filter(Boolean).join(' ').trim(),
      role: memberRoleLabel(member.PastoralService),
    }));
    const images = await renderBirthdayImages(rows, `Our ${monthNames.value} Celebrants`);
    if (!isActive || !imageState.isOpen) return;
    Object.assign(imageState, { status: 'success', images });
  } catch (error) {
    if (isActive) Object.assign(imageState, { status: 'error', message: error.message });
  }
}

function imageName(index) {
  const suffix = imageState.images.length > 1 ? `-${index + 1}` : '';
  return `birthday-greetings-${monthSlug.value}${suffix}.png`;
}

function downloadImage(index) {
  downloadBlob(imageState.images[index].blob, imageName(index));
}

async function downloadAllImages() {
  for (let index = 0; index < imageState.images.length; index += 1) {
    downloadImage(index);
    // Browsers drop downloads fired in the same instant.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

function closeImages() {
  Object.assign(imageState, { isOpen: false, status: 'idle', message: '', images: [] });
}

async function load() {
  Object.assign(loadState, { status: 'loading', message: '' });
  try {
    const [rows, areaNames] = await Promise.all([
      fetchAllRows('members', SELECT_COLUMNS, { orderBy: 'MemberIDNo' }),
      loadAssignedAreaNames(),
    ]);
    if (!isActive) return;
    members.value = rows.map((member) => ({ ...member, birthday: parseBirthday(member.Birthday) }));
    assignedAreaNames.value = areaNames;
    Object.assign(loadState, { status: 'success', message: '' });
  } catch (error) {
    if (isActive) Object.assign(loadState, { status: 'error', message: error.message });
  }
}

onMounted(load);
onBeforeUnmount(() => {
  isActive = false;
});
</script>

<template>
  <section class="card">
    <div class="card-pad section-head">
      <div>
        <h2 class="section-title">Member Birthdays in {{ monthNames }} ({{ celebrants.length }})</h2>
        <p class="muted small sub">From the Birthday saved on each member in Oracle. No OGD sign-in needed.</p>
      </div>
      <div class="row actions">
        <button class="btn btn-sm" :disabled="!visibleCelebrants.length" @click="openImages"><Image :size="14" />Greeting Image</button>
        <button class="btn btn-sm" :disabled="!visibleCelebrants.length" @click="handleExport"><Download :size="14" />Export CSV</button>
      </div>
    </div>
    <LoadingBlock v-if="loadState.status === 'loading'" />
    <div v-else-if="loadState.status === 'error'" class="card-pad stack">
      <p class="text-danger">{{ loadState.message }}</p>
      <div><button class="btn btn-sm" @click="load">Try again</button></div>
    </div>
    <template v-else>
      <div class="card-pad search-pad months">
        <span class="field-label">Months <span class="muted">(choose one or more)</span></span>
        <div class="tabs" role="group" aria-label="Months">
          <button v-for="(name, index) in MONTHS" :key="name" class="tab" :class="{ active: selectedMonths.includes(index + 1) }" :aria-pressed="selectedMonths.includes(index + 1)" @click="toggleMonth(index + 1)">{{ name.slice(0, 3) }}</button>
        </div>
      </div>
      <div class="card-pad search-pad filters">
        <label class="field">
          <span class="field-label">Area</span>
          <select v-model="filters.area" class="select" aria-label="Area">
            <option v-for="option in areaOptions" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Status</span>
          <select v-model="filters.status" class="select" aria-label="Status">
            <option value="All">All</option>
            <option v-for="option in STATUS_OPTIONS" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <div class="search"><SearchInput v-model="search" placeholder="Search name, ID, area or household..." /></div>
      </div>
      <p v-if="missingBirthdayCount" class="card-pad muted small missing">
        {{ missingBirthdayCount }} of {{ members.length }} members have no Birthday saved yet, so they can't appear here. Add it from Members (Edit) or sync Members from OGD.
      </p>
      <DataTable :columns="columns" :rows="visibleCelebrants" row-key="MemberIDNo" :initial-sort="{ key: 'day', ascending: true }" :empty-text="celebrants.length ? 'No celebrants match your search.' : `No members have a birthday in ${monthNames}.`">
        <template #cell-day="{ row }"><span class="nowrap strong">{{ birthdayLabel(row) }}</span></template>
        <template #cell-name="{ row }">{{ row.Lastname }}, {{ row.Firstname }}<p class="muted tiny">{{ row.MemberIDNo }}</p></template>
        <template #cell-age="{ value }">{{ value ?? '—' }}</template>
      </DataTable>
    </template>

    <AppModal v-if="imageState.isOpen" title="Birthday Greeting Image" :subtitle="`${visibleCelebrants.length} celebrant${visibleCelebrants.length === 1 ? '' : 's'} in ${monthNames}: date, name and role only.`" :width="760" @close="closeImages">
      <LoadingBlock v-if="imageState.status === 'loading'" />
      <p v-else-if="imageState.status === 'error'" class="text-danger">{{ imageState.message }}</p>
      <div v-else class="previews">
        <figure v-for="(image, index) in imageState.images" :key="index" class="preview">
          <img :src="image.url" :alt="`Birthday greeting image ${index + 1} of ${imageState.images.length}`" />
          <figcaption>
            <span v-if="imageState.images.length > 1" class="muted small">Image {{ index + 1 }} of {{ imageState.images.length }}</span>
            <button class="btn btn-sm" @click="downloadImage(index)"><Download :size="14" />Download PNG</button>
          </figcaption>
        </figure>
      </div>
      <template #footer>
        <button class="btn" @click="closeImages">Close</button>
        <button v-if="imageState.images.length > 1" class="btn btn-primary" @click="downloadAllImages"><Download :size="14" />Download all ({{ imageState.images.length }})</button>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-bottom: 0; }
.section-title { font-size: 15px; font-weight: var(--fw-heading); margin: 0; }
.sub { margin: 2px 0 0; }
.search-pad { padding-top: 12px; padding-bottom: 12px; }
.filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
.filters .field { width: 180px; max-width: 100%; }
.search { flex: 1 1 240px; }
.actions { gap: 8px; flex-wrap: wrap; }
.months { display: flex; flex-direction: column; gap: 8px; padding-bottom: 0; }
.previews { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.preview { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.preview img { width: 100%; height: auto; border-radius: var(--radius-md); border: 1px solid var(--line); }
.preview figcaption { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.missing { padding-top: 0; margin: 0; }
.tiny { font-size: 11px; margin: 2px 0 0; }
</style>
