export default {
    title: 'Research Experience',
    data: [
        {
            url: 'https://github.com/Sir-Teo/HCC',
            name: 'NYU Langone Health',
            tags: ['Hybrid, NY', 'June 2024 - Present'],
            descriptions: [
                '• 4D MRI Brain Tumor Segmentation: Developed an automated tumor detection pipeline with 4D Brain MRIs, combining DBSCAN clustering with segmentation models (nnUnet, ResNet3D, MedSAM) and a custom loss function (Dice + BCE Loss), achieving a 25% improvement in F1-score and a 30% reduction in false negatives.',
                '• Multimodal Acute Pancreatitis Severity Prediction: Architected a novel multimodal system integrating CT imaging with clinical variables and a vision transformer backbone, employing ensemble methods to achieve a 0.95 severe AUPRC on an external validation dataset.',
                '• Hepatocellular Carcinoma Recurrence Prediction: Pioneered a transfer learning approach using DinoV2 as a feature extractor on abdominal MRIs; developed and validated a time-to-event model achieving 85% accuracy in predicting liver cancer recurrence.',
                '• Collaborated with teams of radiologists, residents, and machine learning experts; authored and delivered manuscripts and presentations, influencing the adoption of advanced AI implementations within NYU Langone Health diagnostic and prognostic workflows.',
            ],
            poster: '../pdf/hcc_poster.pdf',
        },
        {
            url: 'https://github.com/pstat197/capstone-SLAC',
            name: 'Data Science Capstone',
            tags: ['Sep. 2022', 'Jun. 2023', 'UCSB'],
            descriptions: [
                '• Spearheaded a year-long, intensive capstone sequence focused on x-ray diffraction research, maintaining a consistent engagement via biweekly team meetings.',
                '• Deployed advanced reinforcement learning strategies using the ResNet model to train large-scale, raw crystallographic data sets, leveraging Google Cloud resources and campus-based SLURM computing clusters for maximum efficiency.',
                '• Developed a predictive model with high accuracy in identifying inherent properties of crystallographic data derived from raw x-ray diffraction images, thereby promising to expedite materials research.',
            ],
            poster: '../pdf/SLAC Poster.pdf',
        },
        {
            url: 'https://github.com/Sir-Teo/resonet',
            name: 'Research in Probabilistic Modeling of Renewable Energy Generation',
            tags: ['Mar. 2022', 'Jun. 2022', 'UCSB'],
            descriptions: [
                '• Engaged in a collaborative research project with Professor Michael Ludkovski, contributing as a key team member within a group of four, to explore probabilistic modeling in the realm of renewable energy generation.',
                '• Utilized Python’s Pandas library for comprehensive time series data processing, conducting robust trend analysis of daily and seasonal energy generation using a diverse suite of ten statistical modeling techniques.',
                '• Leveraged three distinct analytical approaches to identify high-risk wind and solar assets, delivering crucial insights that paved the way for enhancements in the reliability and efficiency of the probabilistic model.',
            ],
        },
        {
            url:'https://github.com/Sir-Teo/covid-19',
            name: 'Research in the Build Up of COVID-19 Aerosol in Poorly Ventilated Space',
            tags: ['Mar. 2022', 'Jun. 2022', 'UCSB'],
            descriptions: [
                '• Applied the principles of Lagrangian turbulent airflow theory to real-world COVID-19 transmission cases (n=4), utilizing MATLAB for the implementation of the model, simulation, and visualization of the infection progression probability.',
                '• Collaborated closely with Professor Bjorn Birnir, conducting research focused on the mathematical modeling of COVID-19 transmission dynamics leveraging the Lagrangian turbulent airflow theory.',
                '• Synthesized these findings into a comprehensive model capable of calculating the probability of infection in indoor environments, taking into account factors such as indoor volume, occupant density, and ventilation efficacy.',
            ],
        },
        {
            url: 'https://viu.psych.ucsb.edu',
            name: 'Visual and Image Understanding Lab',
            tags: ['Mar. 2022', 'Jun. 2022', 'Research Assistant', 'UCSB'],
            descriptions: [
                '• Conceptualized and executed a collection of psychological experiments using MATLAB’s Psych Toolbox and Python. These were strategically designed to capture and record participants’ gaze patterns while observing human faces.',
                '• Orchestrated a diverse team of over 20 undergraduates, guiding them through the intricate process of participating in an eye-tracking experiment in accordance with established lab protocols and experimental settings.',
                '• Administered the end-to-end process of data management, including collection, cleaning, and rigorous analysis of eye-tracking data via MATLAB. Utilized Python libraries to craft illustrative schematic diagrams, enriching the empirical evidence presented within a research paper.',
            ],
        },
    ],
    status: 0,
}
