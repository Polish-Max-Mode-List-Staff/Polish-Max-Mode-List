export default {
    props: {
        developers: {
            type: Array,
            required: true,
        },
        game: {
            type: String,
            required: true,
        },
        verifier: {
            type: String,
            required: true,
        },
        dateVerified: {
            type: String,
            required: true,
        },
    },
    template: `
        <div class="level-authors">
            <template v-if="selfVerified">
                <div class="type-title-sm">Developer & Verifier</div>
                <p class="type-body">
                    <span>{{ developers }}</span>
                </p>
            </template>
            <template v-else>
                <div class="type-title-sm">Developer(s)</div>
                <p class="type-body">
                    <template v-for="(developer, index) in developers" :key="\`developer-\$\{developer\}\`">
                        <span >{{ developers }}</span
                        ><span v-if="index < developers.length - 1">, </span>
                    </template>
                </p>
                <div class="type-title-sm">Game</div>
                <p class="type-body">
                    <span>{{ game }}</span>
                </p>
                <div class="type-title-sm">Verifier</div>
                <p class="type-body">
                    <span>{{ verifier }}</span>
                </p>
            </template>
            <div class="type-title-sm">Date Verified</div>
            <p class="type-body">
                <span>{{ dateVerified }}</span>
            </p>
        </div>
    `,

    computed: {
        selfVerified() {
            return this.developers === this.verifier;
        },
    },
};
