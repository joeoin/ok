/** Realistic (trimmed) Ad Library payload fixtures for parser tests. */

/** Legacy `async/search_ads` shape: camelCase, results as array-of-arrays. */
export const legacyPayload = {
  payload: {
    results: [
      [
        {
          adArchiveID: '1234567890',
          adid: '0',
          pageID: '111222333444',
          pageName: 'Acme Solar',
          publisherPlatform: ['FACEBOOK', 'INSTAGRAM'],
          isActive: true,
          startDate: 1750000000,
          endDate: null,
          collationCount: 3,
          languages: ['en'],
          snapshot: {
            page_name: 'Acme Solar',
            body: { text: 'Cut your energy bill by 40%.<br>Free quote today &amp; save.' },
            title: 'Go Solar, Save Big',
            link_description: 'Trusted by 10,000 homeowners',
            link_url: 'https://acmesolar.example/quote',
            cta_text: 'Get Quote',
            cta_type: 'GET_QUOTE',
            display_format: 'IMAGE',
            images: [{ original_image_url: 'https://cdn.example/img1.jpg', resized_image_url: 'https://cdn.example/img1_r.jpg' }],
            videos: [],
            cards: [],
          },
        },
      ],
    ],
    isResultComplete: true,
  },
};

/** GraphQL shape: snake_case nodes nested in edges/collated_results. */
export const graphqlPayload = {
  data: {
    ad_library_main: {
      search_results_connection: {
        edges: [
          {
            node: {
              collated_results: [
                {
                  ad_archive_id: '9876543210',
                  page_id: '111222333444',
                  page_name: 'Acme Solar',
                  publisher_platform: ['FACEBOOK'],
                  is_active: true,
                  start_date: 1750100000,
                  end_date: null,
                  collation_count: 1,
                  snapshot: {
                    page_name: 'Acme Solar',
                    body: { markup: { __html: 'Winter special: <b>free installation</b>' } },
                    title: null,
                    cta_text: 'Learn More',
                    cta_type: 'LEARN_MORE',
                    link_url: 'https://acmesolar.example/winter',
                    display_format: 'VIDEO',
                    images: [],
                    videos: [
                      {
                        video_hd_url: 'https://cdn.example/vid.mp4',
                        video_preview_image_url: 'https://cdn.example/vid_thumb.jpg',
                      },
                    ],
                    cards: [],
                  },
                },
              ],
            },
          },
        ],
        page_info: { has_next_page: true },
      },
    },
  },
};

/** Typeahead payload with advertiser page suggestions. */
export const typeaheadPayload = {
  payload: {
    pageResults: [
      {
        id: '111222333444',
        name: 'Acme Solar',
        category: 'Solar Energy Company',
        likes: 52340,
        verification: 'BLUE_VERIFIED',
        imageURI: 'https://cdn.example/acme.png',
        country: 'US',
      },
      {
        id: '555666777888',
        name: 'Acme Solar Panels UK',
        category: 'Energy Company',
        likes: 1200,
        verification: 'NOT_VERIFIED',
        imageURI: null,
        country: 'GB',
      },
    ],
  },
};
