<script setup>
import { Download, Image } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
import DataTable from '@/components/DataTable.vue';
import LoadingBlock from '@/components/LoadingBlock.vue';
import SearchInput from '@/components/SearchInput.vue';
import { buildCouples, ordinal, yearsMarried } from '@/lib/anniversaries';
import { buildAreaOptions, loadAssignedAreaNames, matchesArea } from '@/lib/areas';
import { renderAnniversaryImages } from '@/lib/birthdayImage';
import { downloadBlob, exportCsv, fetchAllRows } from '@/lib/data';
import { memberRoleLabel, STATUS_OPTIONS } from '@/lib/members';

// Wedding anniversaries worked out from the Church Wedding Date saved on
// Oracle's own members ("WeddingDate"), so no OGD sign-in is needed. When
// both spouses are members they are listed once, as a couple. Row-level
// security already limits members to the account's chapters.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SELECT_COLUMNS = 'MemberIDNo, Lastname, Firstname, PastoralService, AreaName, NameOfHouseholdHead, Status, MobileNo, Phone, Email, SpouseName, WeddingDate';

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
// A couple shows when either spouse fits the filter.
const coupleStatus = (couple) => [...new Set(couple.members.map(statusOf))].join(' / ');
const coupleArea = (couple) => [...new Set(couple.members.map((member) => member.AreaName).filter(Boolean))].join(' / ');
const coupleHousehold = (couple) => couple.members.map((member) => member.NameOfHouseholdHead).find(Boolean) || '';
const coupleContact = (couple) => couple.members.map((member) => member.MobileNo || member.Phone || member.Email).find(Boolean) || '';
const coupleRoles = (couple) => [...new Set(couple.members.map((member) => memberRoleLabel(member.PastoralService)))].join(' / ');
const coupleIds = (couple) => couple.members.map((member) => member.MemberIDNo).join(', ');

const couples = computed(() => buildCouples(members.value));
const areaOptions = computed(() => buildAreaOptions(assignedAreaNames.value, members.value.map((member) => member.AreaName)));
const datedCount = computed(() => members.value.filter((member) => member.WeddingDate).length);

const celebrants = computed(() => {
  const { area, status } = filters.value;
  return couples.value.filter((couple) => selectedMonths.value.includes(couple.wedding.month)
    && couple.members.some((member) => matchesArea(area, member.AreaName) && (status === 'All' || statusOf(member) === status)));
});

const visibleCelebrants = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return celebrants.value;
  return celebrants.value.filter((couple) => [couple.name, couple.spouseName, ...couple.members.flatMap((member) => [member.Firstname, member.Lastname, member.MemberIDNo, member.AreaName, member.NameOfHouseholdHead])]
    .filter(Boolean).join(' ').toLowerCase().includes(query));
});

const anniversaryLabel = (couple) => new Date(2000, couple.wedding.month - 1, couple.wedding.day).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
const anniversaryOrder = (couple) => couple.wedding.month * 100 + couple.wedding.day;
const byAnniversary = (a, b) => anniversaryOrder(a) - anniversaryOrder(b) || a.name.localeCompare(b.name);
const years = (couple) => yearsMarried(couple, year);

const columns = [
  { key: 'day', label: 'Anniversary', value: anniversaryOrder },
  { key: 'name', label: 'Couple', value: (couple) => couple.name },
  { key: 'years', label: `Years (${year})`, value: years },
  { key: 'role', label: 'Role', value: coupleRoles },
  { key: 'area', label: 'Area', value: coupleArea },
  { key: 'household', label: 'Household Head', value: coupleHousehold },
  { key: 'contact', label: 'Contact', value: coupleContact },
  { key: 'status', label: 'Status', value: coupleStatus },
];

const EXPORT_COLUMNS = [
  { key: 'anniversary', label: 'Anniversary', value: anniversaryLabel },
  { key: 'WeddingDate', label: 'Church Wedding Date', value: (couple) => couple.WeddingDate },
  { key: 'years', label: `Years (${year})`, value: (couple) => years(couple) ?? '' },
  { key: 'name', label: 'Couple', value: (couple) => couple.name },
  { key: 'ids', label: 'Member IDs', value: coupleIds },
  { key: 'role', label: 'Role', value: coupleRoles },
  { key: 'area', label: 'Area', value: coupleArea },
  { key: 'household', label: 'Household Head', value: coupleHousehold },
  { key: 'MobileNo', label: 'Mobile', value: (couple) => couple.members.map((member) => member.MobileNo).filter(Boolean).join(' / ') },
  { key: 'Email', label: 'Email', value: (couple) => couple.members.map((member) => member.Email).filter(Boolean).join(' / ') },
  { key: 'status', label: 'Status', value: coupleStatus },
];

function handleExport() {
  if (!visibleCelebrants.value.length) return;
  exportCsv(`wedding-anniversaries-${monthSlug.value}`, EXPORT_COLUMNS, [...visibleCelebrants.value].sort(byAnniversary));
}

// Greeting images of the couples on screen (filters and search applied),
// with only the date, the couple's names and the years married.
const imageState = reactive({ isOpen: false, status: 'idle', message: '', images: [] });

async function openImages() {
  if (!visibleCelebrants.value.length) return;
  Object.assign(imageState, { isOpen: true, status: 'loading', message: '', images: [] });
  try {
    const rows = [...visibleCelebrants.value].sort(byAnniversary).map((couple) => ({
      month: couple.wedding.month,
      day: couple.wedding.day,
      name: couple.name,
      role: years(couple) ? `${ordinal(years(couple))} Wedding Anniversary` : 'Wedding Anniversary',
    }));
    const images = await renderAnniversaryImages(rows, `Our ${monthNames.value} Celebrants`);
    if (!isActive || !imageState.isOpen) return;
    Object.assign(imageState, { status: 'success', images });
  } catch (error) {
    if (isActive) Object.assign(imageState, { status: 'error', message: error.message });
  }
}

function imageName(index) {
  const suffix = imageState.images.length > 1 ? `-${index + 1}` : '';
  return `anniversary-greetings-${monthSlug.value}${suffix}.png`;
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
    members.value = rows;
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
        <h2 class="section-title">Wedding Anniversaries in {{ monthNames }} ({{ celebrants.length }})</h2>
        <p class="muted small sub">From the Church Wedding Date saved on each member in Oracle. Spouses who are both members are listed once. No OGD sign-in needed.</p>
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
      <p class="card-pad muted small missing">
        {{ datedCount }} of {{ members.length }} members have a Church Wedding Date saved; only they can appear here. Add it from Members (Edit) or sync Members from OGD.
      </p>
      <DataTable :columns="columns" :rows="visibleCelebrants" row-key="key" :initial-sort="{ key: 'day', ascending: true }" :empty-text="celebrants.length ? 'No couples match your search.' : `No wedding anniversaries in ${monthNames}.`">
        <template #cell-day="{ row }"><span class="nowrap strong">{{ anniversaryLabel(row) }}</span><p class="muted tiny">{{ row.WeddingDate }}</p></template>
        <template #cell-name="{ row }">{{ row.name }}<p class="muted tiny">{{ coupleIds(row) }}<template v-if="row.spouseName"> · spouse not a member</template></p></template>
        <template #cell-years="{ value }">{{ value ? ordinal(value) : '—' }}</template>
      </DataTable>
    </template>

    <AppModal v-if="imageState.isOpen" title="Anniversary Greeting Image" :subtitle="`${visibleCelebrants.length} couple${visibleCelebrants.length === 1 ? '' : 's'} in ${monthNames}: date, names and years married only.`" :width="900" @close="closeImages">
      <LoadingBlock v-if="imageState.status === 'loading'" />
      <p v-else-if="imageState.status === 'error'" class="text-danger">{{ imageState.message }}</p>
      <div v-else class="previews">
        <figure v-for="(image, index) in imageState.images" :key="index" class="preview">
          <img :src="image.url" :alt="`Anniversary greeting image ${index + 1} of ${imageState.images.length}`" />
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
.previews { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 16px; }
.preview { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.preview img { width: 100%; height: auto; border-radius: var(--radius-md); border: 1px solid var(--line); }
.preview figcaption { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.missing { padding-top: 0; margin: 0; }
.tiny { font-size: 11px; margin: 2px 0 0; }
</style>
