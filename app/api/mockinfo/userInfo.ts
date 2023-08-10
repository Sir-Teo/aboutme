export default {
    data: {
        basicInfo: {
            name: 'Teo Zeng',
            career: 'Data Scientist',
            avatar: './user/avatar.jpg',
            snapshot: './user/snapshot.png',
            bio: 'The more you know, the more you know!',
        },
        contactInfo: {
            email: 'zengwc.teo2016@outlook.com',
            website: 'https://teozeng.dev',
            website2: 'https://sir-teo.github.io',
            phone: '8058002486',
            countryCode: '1',
            city: 'New York',
        },
        socials: [
            {
                social: 'github',
                account: '@Sir-Teo',
                link: 'https://github.com/Sir-Teo',
            },
            {
                social: 'wechat',
                account: '@Teo',
                qrcode: './user/wechat_qrcode.jpg',
            },
            {
                social: 'bilibili',
                account: '@master_teo',
                link: 'https://space.bilibili.com/299736746',
            },
            {
                social: 'instagram',
                account: '@sir_teo',
                link: 'https://www.instagram.com/sir_teo',
            },
            {
                social: 'online-go',
                account: '@Master Teo',
                link: 'https://online-go.com/user/view/622443',
            },

        ],
        languages: [
            { language: 'Chinese', level: 'native' },
            { language: 'English', level: 'native' },
            { language: 'Cantonese', level: 'native' },
        ],
        hobbies: [
            { hobby: 'Travelling', type: 'travel' },
            { hobby: 'Basketball', type: 'basketball' },
            { hobby: 'Scuba', type: 'scuba' },
            { hobby: 'Photography', type: 'photography' },
            { hobby: 'Coding', type: 'coding' },
            { hobby: 'Design', type: 'design' },
            { hobby: 'Music', type: 'music' },
            { hobby: 'Golf', type: 'golf' },
            { hobby: 'Skiing', type: 'skiing' },
        ],
    },
    status: 0,
}
