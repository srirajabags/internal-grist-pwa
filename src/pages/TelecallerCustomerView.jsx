import React from 'react';
import CustomerConversationView from '../components/CustomerConversationView';

const TelecallerCustomerView = (props) => {
    return (
        <CustomerConversationView
            {...props}
            defaultMedium="CALL"
            defaultOutcome="NOT RESPONDING"
            enableLocationUpdate={false}
            title="Conversation History"
        />
    );
};

export default TelecallerCustomerView;
