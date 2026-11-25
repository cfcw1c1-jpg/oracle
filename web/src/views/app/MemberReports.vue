<script setup>
import MemberBirthdays from '@/components/MemberBirthdays.vue';
import PageHead from '@/components/PageHead.vue';

// Reports worked out from Oracle's own data. Each report is its own section;
// add new ones below.
</script>

<template>
  <div class="page">
    <PageHead title="Reports" subtitle="Reports from the members saved in Oracle." />
    <MemberBirthdays />
  </div>
</template>
